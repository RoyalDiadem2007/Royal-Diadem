/**
 * Flag Center tests driven through the real App: real router, real auth
 * store, real components. Only fetch (the network boundary) is mocked.
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

const FLAGS_BODY = {
  flags: [
    {
      id: 'flag-1',
      source: 'ai',
      entityType: 'crown_check',
      severity: 'high',
      status: 'new',
      createdAt: '2026-07-18T15:00:00Z',
      resolvedAt: null,
      adminNotes: null,
      studentName: 'Amber',
      detail: 'Crown Check 2026-07-17 — 3 consecutive check-ins at or below 2',
      flaggedBy: null,
    },
    {
      id: 'flag-2',
      source: 'peer',
      entityType: 'share_post',
      severity: 'medium',
      status: 'reviewed',
      createdAt: '2026-07-17T15:00:00Z',
      resolvedAt: null,
      adminNotes: null,
      studentName: 'Jada',
      detail: 'Share post 2026-07-17 — now pending',
      flaggedBy: 'Nia',
    },
  ],
  scope: 'open',
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
  listUrls: string[];
  writes: RequestInit[];
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
            newFlags: 2,
            highSeverityNewFlags: 1,
            todaysCrownChecks: 0,
            pending: {
              openFlags: 0,
              moderation: 0,
              guardianRequests: 0,
              encouragementDrafts: 0,
              upcomingEvents: 0,
            },
          }),
        );
      }
      if (target.endsWith('/admin-flags/update') && init !== undefined) {
        stub.writes.push(init);
        return Promise.resolve(jsonResponse({ status: 'resolved' }));
      }
      if (target.includes('/admin-flags')) {
        stub.listUrls.push(target);
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
  await user.click(within(nav).getByRole('link', { name: 'Flags' }));
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

describe('admin Flag Center', () => {
  it('shows AI and peer flags with the calm crown for high severity', async () => {
    const stub: FetchStub = { listResponses: [jsonResponse(FLAGS_BODY)], listUrls: [], writes: [] };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenSection();

    expect(await screen.findByText('Amber')).toBeInTheDocument();
    expect(screen.getByText(/3 consecutive check-ins/)).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'High severity — needs a gentle check-in' }),
    ).toBeInTheDocument();
    // Peer attribution, admin-only.
    expect(screen.getByText(/Peer flag/)).toBeInTheDocument();
    expect(screen.getByText(/from Nia/)).toBeInTheDocument();
    // Rows link into the owning sections.
    expect(screen.getByRole('link', { name: 'Open Crown Checks' })).toHaveAttribute(
      'href',
      '/admin/crown-checks',
    );
    expect(screen.getByRole('link', { name: 'Open Share posts' })).toHaveAttribute(
      'href',
      '/admin/share',
    );
    // Default scope asks only for open flags.
    expect(stub.listUrls[0]).toContain('scope=open');
  });

  it('marks a new flag reviewed', async () => {
    const stub: FetchStub = {
      listResponses: [jsonResponse(FLAGS_BODY), jsonResponse(FLAGS_BODY)],
      listUrls: [],
      writes: [],
    };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenSection();
    await screen.findByText('Amber');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Mark reviewed' }));

    await screen.findByText('Marked reviewed.');
    expect(sentBody(stub.writes[0])).toEqual({ flagId: 'flag-1', status: 'reviewed' });
  });

  it('resolves with a note after confirmation', async () => {
    const stub: FetchStub = {
      listResponses: [jsonResponse(FLAGS_BODY), jsonResponse(FLAGS_BODY)],
      listUrls: [],
      writes: [],
    };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenSection();
    await screen.findByText('Amber');

    const user = userEvent.setup();
    const resolveButtons = screen.getAllByRole('button', { name: 'Resolve' });
    if (resolveButtons[0] === undefined) {
      throw new Error('no resolve button rendered');
    }
    await user.click(resolveButtons[0]);
    expect(stub.writes).toHaveLength(0);

    await user.type(screen.getByLabelText('Resolution note'), 'Called and prayed with her.');
    await user.click(screen.getByRole('button', { name: 'Confirm resolve' }));

    await screen.findByText('Resolved.');
    expect(sentBody(stub.writes[0])).toEqual({
      flagId: 'flag-1',
      status: 'resolved',
      note: 'Called and prayed with her.',
    });
  });

  it('switches to full history', async () => {
    const stub: FetchStub = {
      listResponses: [
        jsonResponse(FLAGS_BODY),
        jsonResponse({ ...FLAGS_BODY, scope: 'all', flags: [] }),
      ],
      listUrls: [],
      writes: [],
    };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenSection();
    await screen.findByText('Amber');

    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/Everything \(history\)/));

    await screen.findByText('No flags recorded yet.');
    expect(stub.listUrls[1]).toContain('scope=all');
  });
});
