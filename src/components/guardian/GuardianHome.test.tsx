/**
 * Guardian portal tests driven through the real App: real router, real auth
 * store, real components. Only fetch (the network boundary) is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { resetAuthForTests } from '@/lib/authStore';

vi.mock('@/lib/turnstile', () => ({
  getTurnstileToken: vi.fn(() => Promise.resolve('turnstile-token-0123456789')),
}));

const GUARDIAN_SESSION = {
  token: 'raw-guardian-token',
  expiresAt: '2026-07-18T00:00:00.000Z',
  webauthnRegistered: false,
  subject: { type: 'guardian', id: 'acct-1', displayName: 'Rae Linked', role: 'guardian' },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Routes = Record<string, Response[]>;

function stubFetch(routes: Routes, calls: Record<string, RequestInit[]> = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (target.endsWith('/auth-login')) {
        return Promise.resolve(jsonResponse(GUARDIAN_SESSION));
      }
      for (const [suffix, responses] of Object.entries(routes)) {
        if (target.endsWith(suffix)) {
          (calls[suffix] ??= []).push(init ?? {});
          const next = responses.shift();
          return Promise.resolve(next ?? jsonResponse({ error: 'server_error' }, 500));
        }
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    }),
  );
}

async function signInAsGuardian(): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Email'), 'rae@example.com');
  await user.type(screen.getByLabelText('PIN'), '481516');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByRole('heading', { name: 'Hello, Rae Linked' });
}

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
  window.history.replaceState(null, '', '/guardian');
});

afterEach(() => {
  resetAuthForTests();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('guardian portal (OD-19 build B)', () => {
  it('walks the consent ceremony: ask → code from her app → 30-minute window', async () => {
    const calls: Record<string, RequestInit[]> = {};
    stubFetch(
      {
        '/guardian-portal': [
          jsonResponse({
            students: [
              { studentId: 'stu-1', displayName: 'Maya', state: 'none', accessExpiresAt: null },
            ],
          }),
          jsonResponse({
            students: [
              { studentId: 'stu-1', displayName: 'Maya', state: 'pending', accessExpiresAt: null },
            ],
          }),
          jsonResponse({
            students: [
              {
                studentId: 'stu-1',
                displayName: 'Maya',
                state: 'active',
                accessExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
              },
            ],
          }),
        ],
        '/guardian-portal/request-access': [
          jsonResponse({ state: 'pending', accessExpiresAt: null }, 201),
        ],
        '/guardian-portal/enter-code': [
          jsonResponse({
            state: 'active',
            accessExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
          }),
        ],
      },
      calls,
    );

    render(<App />);
    await signInAsGuardian();

    // The deal is stated up front.
    expect(screen.getByText(/always happens with her knowledge/)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Ask to view her account' }));
    expect(await screen.findByRole('status')).toHaveTextContent('her choice to share it');

    const codeInput = await screen.findByLabelText('Consent code for Maya');
    await user.type(codeInput, '135791');
    await user.click(screen.getByRole('button', { name: 'Open access' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Access open for 30 minutes.');
    const sent = calls['/guardian-portal/enter-code']?.[0]?.body;
    if (typeof sent !== 'string') {
      throw new Error('enter-code body was not a JSON string');
    }
    expect(JSON.parse(sent)).toEqual({ studentId: 'stu-1', code: '135791' });

    expect(
      await screen.findByRole('button', { name: /View \(\d+ min left\)/ }),
    ).toBeInTheDocument();
  });

  it('shows the student view — profile and mood trend, never note text', async () => {
    stubFetch({
      '/guardian-portal': [
        jsonResponse({
          students: [
            {
              studentId: 'stu-1',
              displayName: 'Maya',
              state: 'active',
              accessExpiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
            },
          ],
        }),
      ],
      'guardian-portal/student?studentId=stu-1': [
        jsonResponse({
          student: {
            studentId: 'stu-1',
            displayName: 'Maya',
            firstName: 'Maya',
            lastName: 'Linked',
            status: 'active',
            phase: 'Phase 1',
            enrollmentDate: '2026-07-01T00:00:00.000Z',
          },
          trend: [{ checkDate: '2026-07-17', moodScore: 4, moodEmoji: '😊' }],
          accessExpiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
        }),
      ],
    });

    render(<App />);
    await signInAsGuardian();

    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: /View \(\d+ min left\)/ }));

    expect(await screen.findByRole('heading', { name: 'Maya' })).toBeInTheDocument();
    expect(screen.getByText('Maya Linked')).toBeInTheDocument();
    expect(screen.getByText(/Steady — /)).toBeInTheDocument();
    expect(screen.getByText(/window closes in \d+ min/)).toBeInTheDocument();
  });

  it('handles a wrong or expired code without opening anything', async () => {
    stubFetch({
      '/guardian-portal': [
        jsonResponse({
          students: [
            { studentId: 'stu-1', displayName: 'Maya', state: 'pending', accessExpiresAt: null },
          ],
        }),
      ],
      '/guardian-portal/enter-code': [jsonResponse({ error: 'invalid_code' }, 401)],
    });

    render(<App />);
    await signInAsGuardian();

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Consent code for Maya'), '000000');
    await user.click(screen.getByRole('button', { name: 'Open access' }));

    expect(await screen.findByRole('status')).toHaveTextContent("didn't match or has expired");
    expect(screen.queryByRole('button', { name: /View \(/ })).not.toBeInTheDocument();
  });
});
