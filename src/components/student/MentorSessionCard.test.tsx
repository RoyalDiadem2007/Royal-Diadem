/**
 * "Time with a mentor" card tests through the real App: real router, real
 * auth store, real component. Only fetch (the network boundary) is mocked.
 * The card's promise is honesty about state: ask → a person is finding your
 * time → it's on the calendar.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { resetAuthForTests } from '@/lib/authStore';
import { localDateIso } from '@/lib/dailyMessage';

vi.mock('@/lib/turnstile', () => ({
  getTurnstileToken: vi.fn(() => Promise.resolve('turnstile-token-0123456789')),
}));

const SESSION_BODY = {
  token: 'raw-student-token',
  expiresAt: '2026-07-18T00:00:00.000Z',
  subject: { type: 'student', id: 'stu-1', displayName: 'Maya', role: 'student' },
};

function daysFromToday(days: number): string {
  const base = new Date(`${localDateIso(new Date())}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type FetchStub = {
  listResponses: Response[];
  createResponses: Response[];
  createBodies: RequestInit[];
};

function stubFetch(stub: FetchStub): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (target.endsWith('/auth-login')) {
        return Promise.resolve(jsonResponse(SESSION_BODY));
      }
      if (target.endsWith('/mentor-sessions/request') && init !== undefined) {
        stub.createBodies.push(init);
        const next = stub.createResponses.shift();
        return Promise.resolve(next ?? jsonResponse({ error: 'server_error' }, 500));
      }
      if (target.endsWith('/mentor-sessions')) {
        const next = stub.listResponses.shift();
        return Promise.resolve(next ?? jsonResponse({ requests: [] }));
      }
      if (target.endsWith('/friend-invites')) {
        return Promise.resolve(jsonResponse({ invites: [] }));
      }
      if (target.endsWith('/student-guardian-requests')) {
        return Promise.resolve(jsonResponse({ requests: [] }));
      }
      if (target.endsWith('/crown-check')) {
        return Promise.resolve(jsonResponse({ today: null, recent: [] }));
      }
      if (target.endsWith('/student-profile')) {
        return Promise.resolve(
          jsonResponse({
            profile: { avatarKey: null, proudOf: null },
            goals: [],
            strengths: [],
            strengthOptions: [],
          }),
        );
      }
      if (target.includes('/rest/v1/')) {
        return Promise.resolve(jsonResponse([]));
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    }),
  );
}

async function signIn(): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Crown code'), 'RD-7F3K');
  await user.type(screen.getByLabelText('PIN'), '123456');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByRole('heading', { name: /Maya/ });
}

function sentBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== 'string') {
    throw new Error('request body was not a JSON string');
  }
  return JSON.parse(init.body) as Record<string, unknown>;
}

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
  window.history.replaceState(null, '', '/login');
});

afterEach(() => {
  resetAuthForTests();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('mentor session card', () => {
  it('sends her offered windows and lands in the waiting state', async () => {
    const stub: FetchStub = {
      listResponses: [
        jsonResponse({ requests: [] }),
        jsonResponse({
          requests: [
            {
              id: 'req-1',
              status: 'pending',
              preferredWindows: [{ date: daysFromToday(3), slot: 'after_school' }],
              scheduledDate: null,
              scheduledTime: null,
              endTime: null,
              createdAt: '2026-07-19T10:00:00Z',
            },
          ],
        }),
      ],
      createResponses: [jsonResponse({ requestId: 'req-1' }, 201)],
      createBodies: [],
    };
    stubFetch(stub);

    render(<App />);
    await signIn();

    const card = await screen.findByLabelText('Time with a mentor');
    const user = userEvent.setup();
    const askDate = daysFromToday(3);
    await user.type(screen.getByLabelText('Day'), askDate);
    await user.selectOptions(screen.getByLabelText('Time of day'), 'after_school');
    await user.click(screen.getByRole('button', { name: 'Ask for time' }));

    await screen.findByText('Request sent. A real person will confirm your time. 💛');
    expect(sentBody(stub.createBodies[0])).toEqual({
      preferredWindows: [{ date: askDate, slot: 'after_school' }],
    });
    // The refetched pending state replaces the form.
    await screen.findByText('A real person is finding your time.');
    expect(card).toHaveTextContent('Times you offered');
  });

  it('shows a confirmed upcoming session with Add to my calendar', async () => {
    const scheduled = daysFromToday(5);
    stubFetch({
      listResponses: [
        jsonResponse({
          requests: [
            {
              id: 'req-2',
              status: 'confirmed',
              preferredWindows: [{ date: scheduled, slot: 'afternoon' }],
              scheduledDate: scheduled,
              scheduledTime: '15:30',
              endTime: '16:15',
              createdAt: '2026-07-19T10:00:00Z',
            },
          ],
        }),
      ],
      createResponses: [],
      createBodies: [],
    });

    render(<App />);
    await signIn();

    await screen.findByText('It’s on the calendar');
    expect(screen.getByText(/15:30–16:15/)).toBeInTheDocument();

    // The download stays on her device and carries only the generic title.
    // jsdom has no object-URL support; add the two statics without touching
    // the URL constructor itself.
    const objectUrl = vi.fn<(blob: Blob) => string>(() => 'blob:mentor-time');
    Object.defineProperty(URL, 'createObjectURL', {
      value: objectUrl,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn(),
      configurable: true,
      writable: true,
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Add to my calendar/ }));
    expect(objectUrl).toHaveBeenCalledTimes(1);
    const captured = objectUrl.mock.calls[0]?.[0];
    if (captured === undefined) {
      throw new Error('no calendar file was produced');
    }
    const text = await captured.text();
    expect(text).toContain('SUMMARY:Mentor time');
    expect(text).not.toMatch(/royal/i);
  });

  it('tells her gently when a request is already open', async () => {
    const stub: FetchStub = {
      listResponses: [jsonResponse({ requests: [] }), jsonResponse({ requests: [] })],
      createResponses: [jsonResponse({ error: 'request_open' }, 409)],
      createBodies: [],
    };
    stubFetch(stub);

    render(<App />);
    await signIn();

    await screen.findByLabelText('Time with a mentor');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Day'), daysFromToday(2));
    await user.click(screen.getByRole('button', { name: 'Ask for time' }));

    await screen.findByText('You already have a request in — your team is on it.');
  });
});
