/**
 * Relaxation admin section tests driven through the real App: real router,
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

const LIST_BODY = {
  items: [
    {
      id: 'r-1',
      kind: 'affirmation',
      title: 'You are chosen',
      body: 'Crowned on purpose.',
      active: true,
      sortOrder: 0,
      createdAt: '2026-07-18T12:00:00Z',
    },
    {
      id: 'r-2',
      kind: 'scripture',
      title: 'Psalm 46:10',
      body: 'Be still, and know.',
      active: false,
      sortOrder: 0,
      createdAt: '2026-07-18T12:00:00Z',
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
        target.endsWith(`/admin-relaxation/${a}`),
      );
      if (writeAction !== undefined && init !== undefined) {
        stub.writes.push({ action: writeAction, init });
        if (writeAction === 'delete') {
          return Promise.resolve(jsonResponse({ deleted: true }));
        }
        return Promise.resolve(
          jsonResponse({ item: LIST_BODY.items[0] }, writeAction === 'create' ? 201 : 200),
        );
      }
      if (target.includes('/admin-relaxation')) {
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
  await user.click(within(nav).getByRole('link', { name: 'Relaxation' }));
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

describe('admin Relaxation section', () => {
  it('lists the library with kinds and the retired mark', async () => {
    const stub: FetchStub = { listResponses: [jsonResponse(LIST_BODY)], writes: [] };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenSection();

    expect(await screen.findByText('You are chosen')).toBeInTheDocument();
    expect(screen.getByText('Psalm 46:10')).toBeInTheDocument();
    expect(screen.getByText(/retired/)).toBeInTheDocument();
  });

  it('adds a scripture item from the form', async () => {
    const stub: FetchStub = {
      listResponses: [
        jsonResponse({ items: [], page: 1, pageSize: 50, total: 0 }),
        jsonResponse(LIST_BODY),
      ],
      writes: [],
    };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenSection();
    await screen.findByText(/The library is empty/);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Kind'), 'scripture');
    await user.type(screen.getByLabelText('Title'), 'Psalm 46:10');
    await user.type(screen.getByLabelText('Text'), 'Be still, and know.');
    await user.click(screen.getByRole('button', { name: 'Add to library' }));

    await screen.findByText('Added to the library.');
    expect(firstWrite(stub).action).toBe('create');
    expect(sentBody(firstWrite(stub).init)).toEqual({
      kind: 'scripture',
      title: 'Psalm 46:10',
      body: 'Be still, and know.',
    });
  });

  it('retires an active item without deleting it', async () => {
    const stub: FetchStub = {
      listResponses: [jsonResponse(LIST_BODY), jsonResponse(LIST_BODY)],
      writes: [],
    };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenSection();
    await screen.findByText('You are chosen');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Retire' }));

    await screen.findByText(/Retired — hidden from the room/);
    expect(firstWrite(stub).action).toBe('update');
    expect(sentBody(firstWrite(stub).init)).toEqual({
      itemId: 'r-1',
      kind: 'affirmation',
      title: 'You are chosen',
      body: 'Crowned on purpose.',
      active: false,
      sortOrder: 0,
    });
  });
});
