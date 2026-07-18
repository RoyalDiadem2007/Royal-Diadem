/**
 * Calendar admin section tests driven through the real App: real router,
 * real auth store, real components. Only fetch (the network boundary) is
 * mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { resetAuthForTests } from '@/lib/authStore';

vi.mock('@/lib/turnstile', () => ({
  getTurnstileToken: vi.fn(() => Promise.resolve('turnstile-token-0123456789')),
}));

const SUPER_SESSION_BODY = {
  token: 'raw-admin-token',
  expiresAt: '2026-07-18T00:00:00.000Z',
  subject: { type: 'admin', id: 'adm-1', displayName: 'Kenecia', role: 'super_admin' },
};

const EVENTS_BODY = {
  events: [
    {
      id: 'evt-1',
      title: 'Bible study',
      description: 'Bring your journal',
      eventDate: '2026-07-21',
      eventTime: '18:00',
      endTime: '19:30',
      repeatsWeekly: true,
      recurrenceRule: 'FREQ=WEEKLY;UNTIL=20260831',
    },
    {
      id: 'evt-2',
      title: 'Summer retreat',
      description: null,
      eventDate: '2026-08-01',
      eventTime: null,
      endTime: null,
      repeatsWeekly: false,
      recurrenceRule: null,
    },
  ],
  page: 1,
  pageSize: 50,
  total: 2,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type FetchStub = {
  listResponses: Response[];
  writes: { action: string; init: RequestInit }[];
};

function stubFetch(stub: FetchStub): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (target.endsWith('/auth-login')) {
        return Promise.resolve(jsonResponse(SUPER_SESSION_BODY));
      }
      if (target.endsWith('/admin-dashboard')) {
        return Promise.resolve(
          jsonResponse({
            activeStudents: 0,
            newFlags: 0,
            highSeverityNewFlags: 0,
            todaysCrownChecks: 0,
          }),
        );
      }
      const writeAction = ['create', 'update', 'delete'].find((a) =>
        target.endsWith(`/admin-calendar/${a}`),
      );
      if (writeAction !== undefined && init !== undefined) {
        stub.writes.push({ action: writeAction, init });
        if (writeAction === 'delete') {
          return Promise.resolve(jsonResponse({ deleted: true }));
        }
        return Promise.resolve(
          jsonResponse({ event: EVENTS_BODY.events[0] }, writeAction === 'create' ? 201 : 200),
        );
      }
      if (target.includes('/admin-calendar')) {
        const next = stub.listResponses.shift();
        return Promise.resolve(next ?? jsonResponse({ error: 'server_error' }, 500));
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    }),
  );
}

async function signInAndOpenSection(): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Mentor or admin? Sign in here' }));
  await user.type(screen.getByLabelText('Email'), 'kenecia@example.com');
  await user.type(screen.getByLabelText('PIN'), '123456');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  const nav = await screen.findByRole('navigation', { name: 'Admin sections' });
  await user.click(within(nav).getByRole('link', { name: 'Calendar' }));
}

function sentBody(init: RequestInit): Record<string, unknown> {
  if (typeof init.body !== 'string') {
    throw new Error('request body was not a JSON string');
  }
  return JSON.parse(init.body) as Record<string, unknown>;
}

function firstWrite(stub: FetchStub): { action: string; init: RequestInit } {
  const write = stub.writes[0];
  if (write === undefined) {
    throw new Error('no write was captured');
  }
  return write;
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

describe('admin Calendar section', () => {
  it('lists events with dates, times and the weekly mark', async () => {
    const stub: FetchStub = { listResponses: [jsonResponse(EVENTS_BODY)], writes: [] };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenSection();

    expect(await screen.findByText('Bible study')).toBeInTheDocument();
    expect(screen.getByText('18:00–19:30')).toBeInTheDocument();
    expect(screen.getByText('Weekly')).toBeInTheDocument();
    expect(screen.getByText('Summer retreat')).toBeInTheDocument();
    expect(screen.getByText('All day')).toBeInTheDocument();
  });

  it('creates a weekly event with an end date from the form', async () => {
    const stub: FetchStub = {
      listResponses: [
        jsonResponse({ events: [], page: 1, pageSize: 50, total: 0 }),
        jsonResponse(EVENTS_BODY),
      ],
      writes: [],
    };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenSection();
    await screen.findByText(/No upcoming events yet/);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add event' }));
    await user.type(screen.getByLabelText('Title'), 'Bible study');
    await user.type(screen.getByLabelText('Details (optional)'), 'Bring your journal');
    await user.type(screen.getByLabelText('Date'), '2026-07-21');
    await user.type(screen.getByLabelText('Starts (optional)'), '18:00');
    await user.type(screen.getByLabelText('Ends (optional)'), '19:30');
    await user.click(screen.getByLabelText(/Repeats weekly/));
    await user.type(screen.getByLabelText('Until (optional)'), '2026-08-31');
    await user.click(screen.getByRole('button', { name: 'Add to calendar' }));

    await screen.findByText('Event added.');
    expect(stub.writes).toHaveLength(1);
    expect(firstWrite(stub).action).toBe('create');
    expect(sentBody(firstWrite(stub).init)).toEqual({
      title: 'Bible study',
      description: 'Bring your journal',
      eventDate: '2026-07-21',
      eventTime: '18:00',
      endTime: '19:30',
      repeatsWeekly: true,
      repeatUntil: '2026-08-31',
    });
  });

  it('deletes only after an explicit confirmation', async () => {
    const stub: FetchStub = {
      listResponses: [jsonResponse(EVENTS_BODY), jsonResponse(EVENTS_BODY)],
      writes: [],
    };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenSection();
    await screen.findByText('Bible study');

    const user = userEvent.setup();
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
    if (deleteButtons[0] === undefined) {
      throw new Error('no delete button rendered');
    }
    await user.click(deleteButtons[0]);
    expect(stub.writes).toHaveLength(0);
    expect(screen.getByText('Delete this event?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));
    await screen.findByText('Event deleted.');
    expect(stub.writes).toHaveLength(1);
    expect(firstWrite(stub).action).toBe('delete');
    expect(sentBody(firstWrite(stub).init)).toEqual({ eventId: 'evt-1' });
  });
});
