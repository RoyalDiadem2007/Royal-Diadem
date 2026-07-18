/**
 * Announcements admin section tests driven through the real App: real
 * router, real auth store, real components. Only fetch (the network
 * boundary) is mocked.
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

const LIST_BODY = {
  announcements: [
    {
      id: 'ann-2',
      title: 'Retreat sign-ups open',
      body: 'Grab your spot before Friday!',
      priority: 'urgent',
      createdAt: '2026-07-18T15:00:00Z',
      readCount: 3,
    },
    {
      id: 'ann-1',
      title: 'New journal prompts',
      body: 'Fresh prompts are waiting.',
      priority: 'normal',
      createdAt: '2026-07-16T12:00:00Z',
      readCount: 7,
    },
  ],
  activeStudents: 12,
  page: 1,
  pageSize: 20,
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
      const writeAction = ['create', 'delete'].find((a) =>
        target.endsWith(`/admin-announcements/${a}`),
      );
      if (writeAction !== undefined && init !== undefined) {
        stub.writes.push({ action: writeAction, init });
        if (writeAction === 'delete') {
          return Promise.resolve(jsonResponse({ deleted: true }));
        }
        return Promise.resolve(jsonResponse({ announcement: LIST_BODY.announcements[0] }, 201));
      }
      if (target.includes('/admin-announcements')) {
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
  await user.click(within(nav).getByRole('link', { name: 'Announcements' }));
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

describe('admin Announcements section', () => {
  it('shows the feed with read counts against real active students', async () => {
    const stub: FetchStub = { listResponses: [jsonResponse(LIST_BODY)], writes: [] };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenSection();

    expect(await screen.findByText('Retreat sign-ups open')).toBeInTheDocument();
    // "Urgent" appears twice: the compose checkbox and the ann-2 tag.
    expect(screen.getAllByText('Urgent')).toHaveLength(2);
    expect(screen.getByText(/Read by 3 of 12/)).toBeInTheDocument();
    expect(screen.getByText(/Read by 7 of 12/)).toBeInTheDocument();
  });

  it('posts an urgent announcement from the compose form', async () => {
    const stub: FetchStub = {
      listResponses: [
        jsonResponse({ announcements: [], activeStudents: 12, page: 1, pageSize: 20, total: 0 }),
        jsonResponse(LIST_BODY),
      ],
      writes: [],
    };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenSection();
    await screen.findByText(/Nothing posted yet/);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Title'), 'Retreat sign-ups open');
    await user.type(screen.getByLabelText('Message'), 'Grab your spot before Friday!');
    await user.click(screen.getByLabelText(/Urgent/));
    await user.click(screen.getByRole('button', { name: 'Post announcement' }));

    await screen.findByText('Posted — students see it now.');
    expect(firstWrite(stub).action).toBe('create');
    expect(sentBody(firstWrite(stub).init)).toEqual({
      title: 'Retreat sign-ups open',
      body: 'Grab your spot before Friday!',
      priority: 'urgent',
    });
  });

  it('deletes only after an explicit confirmation', async () => {
    const stub: FetchStub = {
      listResponses: [jsonResponse(LIST_BODY), jsonResponse(LIST_BODY)],
      writes: [],
    };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenSection();
    await screen.findByText('Retreat sign-ups open');

    const user = userEvent.setup();
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
    if (deleteButtons[0] === undefined) {
      throw new Error('no delete button rendered');
    }
    await user.click(deleteButtons[0]);
    expect(stub.writes).toHaveLength(0);
    expect(screen.getByText('Delete this announcement?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));
    await screen.findByText('Announcement deleted.');
    expect(firstWrite(stub).action).toBe('delete');
    expect(sentBody(firstWrite(stub).init)).toEqual({ announcementId: 'ann-2' });
  });
});
