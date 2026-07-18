/**
 * Daily Crown Message tests driven through the real App: real router, real
 * auth store, real component. Only fetch (the network boundary) is mocked.
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
  subject: { type: 'student', id: 'stu-1', displayName: 'Jada', role: 'student' },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type FetchStub = {
  messageResponses: Response[];
  messageUrls: string[];
  messageInits: (RequestInit | undefined)[];
};

function stubFetch(stub: FetchStub): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (target.endsWith('/auth-login')) {
        return Promise.resolve(jsonResponse(SESSION_BODY));
      }
      if (target.includes('/rest/v1/encouragement_messages')) {
        stub.messageUrls.push(target);
        stub.messageInits.push(init);
        const next = stub.messageResponses.shift();
        return Promise.resolve(next ?? jsonResponse([]));
      }
      if (target.includes('/rest/v1/')) {
        // Other passive cards (events, announcements) stay quietly empty.
        return Promise.resolve(jsonResponse([]));
      }
      if (target.endsWith('/crown-check')) {
        // The Crown Check card shares the home screen; keep it quietly
        // healthy so these tests assert on the daily message alone.
        return Promise.resolve(jsonResponse({ today: null, recent: [] }));
      }
      if (target.endsWith('/journal')) {
        return Promise.resolve(jsonResponse({ prompts: [], entries: [] }));
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

describe('Daily Crown Message', () => {
  it("shows today's posted message after sign-in, requested with the anon key", async () => {
    const today = localDateIso(new Date());
    const stub: FetchStub = {
      messageResponses: [
        jsonResponse([{ message_text: 'Walk tall today, queen.', scheduled_date: today }]),
      ],
      messageUrls: [],
      messageInits: [],
    };
    stubFetch(stub);

    render(<App />);
    await signIn();

    await screen.findByText('Walk tall today, queen.');
    expect(screen.getByText(/Today’s Crown Message/)).toBeInTheDocument();

    // The read asks for exactly today's posted row, as the anon role.
    expect(stub.messageUrls[0]).toContain('status=eq.posted');
    expect(stub.messageUrls[0]).toContain(`scheduled_date=eq.${today}`);
    const headers = new Headers(stub.messageInits[0]?.headers);
    expect(headers.get('apikey')).toBe('sb_publishable_test');
    // A student's opaque session token must never reach the Data API.
    expect(headers.get('authorization')).toBe('Bearer sb_publishable_test');
  });

  it('renders nothing at all when no message is posted today', async () => {
    const stub: FetchStub = {
      messageResponses: [jsonResponse([])],
      messageUrls: [],
      messageInits: [],
    };
    stubFetch(stub);

    render(<App />);
    await signIn();

    // Wait for the home screen (Crown Check card) before asserting absence.
    await screen.findByRole('radiogroup', { name: 'How is your crown sitting today?' });
    expect(screen.queryByLabelText('Daily Crown Message')).not.toBeInTheDocument();
  });

  it('shows a quiet error with retry, and recovers when retry succeeds', async () => {
    const today = localDateIso(new Date());
    const stub: FetchStub = {
      messageResponses: [
        new Response(null, { status: 500 }),
        jsonResponse([{ message_text: 'Grace looks good on you.', scheduled_date: today }]),
      ],
      messageUrls: [],
      messageInits: [],
    };
    stubFetch(stub);

    render(<App />);
    await signIn();

    await screen.findByText(/Crown Message couldn’t load/);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await screen.findByText('Grace looks good on you.');
    expect(screen.queryByText(/couldn’t load/)).not.toBeInTheDocument();
  });
});
