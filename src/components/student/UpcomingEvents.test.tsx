/**
 * Upcoming events card tests driven through the real App: real router, real
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

type FetchStub = { eventResponses: Response[] };

function stubFetch(stub: FetchStub): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (target.endsWith('/auth-login')) {
        return Promise.resolve(jsonResponse(SESSION_BODY));
      }
      if (target.includes('/rest/v1/calendar_events')) {
        const next = stub.eventResponses.shift();
        return Promise.resolve(next ?? jsonResponse([]));
      }
      if (target.includes('/rest/v1/')) {
        // Other passive cards (daily message, announcements) stay empty.
        return Promise.resolve(jsonResponse([]));
      }
      if (target.endsWith('/crown-check')) {
        return Promise.resolve(jsonResponse({ today: null, recent: [] }));
      }
      if (target.endsWith('/journal')) {
        return Promise.resolve(jsonResponse({ prompts: [], entries: [] }));
      }
      if (target.endsWith('/student-profile')) {
        // The goals card stays in its gentle empty state.
        return Promise.resolve(
          jsonResponse({
            profile: { avatarKey: null, proudOf: null },
            goals: [],
            strengths: [],
            strengthOptions: [],
          }),
        );
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

describe('student Upcoming events card', () => {
  it('lists upcoming dates with times, expanding weekly repeats', async () => {
    const stub: FetchStub = {
      eventResponses: [
        jsonResponse([
          {
            id: 'evt-weekly',
            title: 'Bible study',
            description: 'Bring your journal',
            event_date: daysFromToday(-28),
            event_time: '18:00:00',
            end_time: '19:30:00',
            is_recurring: true,
            recurrence_rule: 'FREQ=WEEKLY',
          },
          {
            id: 'evt-oneoff',
            title: 'Summer retreat',
            description: null,
            event_date: daysFromToday(10),
            event_time: null,
            end_time: null,
            is_recurring: false,
            recurrence_rule: null,
          },
        ]),
      ],
    };
    stubFetch(stub);

    render(<App />);
    await signIn();

    await screen.findByText('Summer retreat');
    const card = screen.getByRole('region', { name: 'Upcoming events' });
    expect(card).toHaveTextContent('Coming up');
    expect(card).toHaveTextContent('Summer retreat');
    // The weekly series from a month back still produces upcoming dates.
    expect(screen.getAllByText('Bible study').length).toBeGreaterThan(0);
    expect(card).toHaveTextContent('18:00–19:30');
    expect(card).toHaveTextContent('Bring your journal');
  });

  it('renders nothing at all when nothing is coming up', async () => {
    const stub: FetchStub = { eventResponses: [jsonResponse([])] };
    stubFetch(stub);

    render(<App />);
    await signIn();

    await screen.findByRole('radiogroup', { name: 'How is your crown sitting today?' });
    expect(screen.queryByLabelText('Upcoming events')).not.toBeInTheDocument();
  });

  it('shows a quiet error with retry, and recovers when retry succeeds', async () => {
    const stub: FetchStub = {
      eventResponses: [
        new Response(null, { status: 500 }),
        jsonResponse([
          {
            id: 'evt-1',
            title: 'Game night',
            description: null,
            event_date: daysFromToday(3),
            event_time: null,
            end_time: null,
            is_recurring: false,
            recurrence_rule: null,
          },
        ]),
      ],
    };
    stubFetch(stub);

    render(<App />);
    await signIn();

    await screen.findByText(/Upcoming events couldn’t load/);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await screen.findByText('Game night');
    expect(screen.queryByText(/couldn’t load/)).not.toBeInTheDocument();
  });
});
