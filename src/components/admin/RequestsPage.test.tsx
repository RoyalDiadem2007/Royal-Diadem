/**
 * Requests queue tests driven through the real App: real router, real auth
 * store, real components. Only fetch (the network boundary) is mocked. The
 * queue's promise: a human picks the session time, a human does the invite
 * outreach, and deciding an invite clears the address from the app.
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

const QUEUE_BODY = {
  sessions: [
    {
      id: 'req-1',
      studentName: 'Amber',
      status: 'pending',
      preferredWindows: [
        { date: '2026-07-24', slot: 'after_school' },
        { date: '2026-07-25', slot: 'morning' },
      ],
      scheduledDate: null,
      scheduledTime: null,
      endTime: null,
      createdAt: '2026-07-19T10:00:00Z',
    },
  ],
  invites: [
    {
      id: 'inv-1',
      studentName: 'Jada',
      email: 'friend@example.com',
      createdAt: '2026-07-19T11:00:00Z',
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type FetchStub = {
  queueResponses: Response[];
  writes: { target: string; init: RequestInit }[];
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
            pending: {
              openFlags: 0,
              moderation: 0,
              guardianRequests: 0,
              encouragementDrafts: 0,
              sessionRequests: 1,
              friendInvites: 1,
              upcomingEvents: 0,
            },
          }),
        );
      }
      if (target.includes('/admin-requests/') && init !== undefined) {
        stub.writes.push({ target, init });
        if (target.endsWith('/sessions/confirm')) {
          return Promise.resolve(
            jsonResponse({
              session: {
                ...QUEUE_BODY.sessions[0],
                status: 'confirmed',
                scheduledDate: '2026-07-24',
                scheduledTime: '15:30',
                endTime: null,
              },
            }),
          );
        }
        if (target.endsWith('/sessions/decline')) {
          return Promise.resolve(jsonResponse({ declined: true }));
        }
        return Promise.resolve(jsonResponse({ decided: true }));
      }
      if (target.endsWith('/admin-requests')) {
        const next = stub.queueResponses.shift();
        return Promise.resolve(next ?? jsonResponse({ sessions: [], invites: [] }));
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
  await user.click(within(nav).getByRole('link', { name: 'Requests' }));
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

describe('admin requests queue', () => {
  it('confirms a session with the real time, prefilled from her first window', async () => {
    const stub: FetchStub = {
      queueResponses: [jsonResponse(QUEUE_BODY), jsonResponse({ sessions: [], invites: [] })],
      writes: [],
    };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenSection();

    await screen.findByText('Amber');
    expect(screen.getByText(/2026-07-24 \(After school\)/)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Pick the time' }));
    expect(screen.getByLabelText('Session date')).toHaveValue('2026-07-24');
    await user.type(screen.getByLabelText('Start time'), '15:30');
    await user.click(screen.getByRole('button', { name: 'Confirm time' }));

    await screen.findByText('Session confirmed — it’s on her card now.');
    const confirm = stub.writes.find((w) => w.target.endsWith('/sessions/confirm'));
    expect(sentBody(confirm?.init)).toEqual({
      requestId: 'req-1',
      date: '2026-07-24',
      time: '15:30',
      endTime: null,
    });
  });

  it('hands the invite to a human: mailto link, then reached-out clears it', async () => {
    const stub: FetchStub = {
      queueResponses: [jsonResponse(QUEUE_BODY), jsonResponse({ sessions: [], invites: [] })],
      writes: [],
    };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenSection();

    await screen.findByText('friend@example.com');
    expect(screen.getByRole('link', { name: 'Write to them' })).toHaveAttribute(
      'href',
      'mailto:friend@example.com',
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'I’ve reached out' }));

    await screen.findByText('Marked reached out — the address is now cleared from the app.');
    const decided = stub.writes.find((w) => w.target.endsWith('/invites/reached-out'));
    expect(sentBody(decided?.init)).toEqual({ inviteId: 'inv-1' });
    expect(screen.queryByText('friend@example.com')).not.toBeInTheDocument();
  });

  it('declines a session so she gets the gentle version, not silence', async () => {
    const stub: FetchStub = {
      queueResponses: [jsonResponse(QUEUE_BODY), jsonResponse({ sessions: [], invites: [] })],
      writes: [],
    };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenSection();

    await screen.findByText('Amber');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Decline' }));

    await screen.findByText('Declined — she’ll see it gently; do follow up with her.');
    const decline = stub.writes.find((w) => w.target.endsWith('/sessions/decline'));
    expect(sentBody(decline?.init)).toEqual({ requestId: 'req-1' });
  });
});
