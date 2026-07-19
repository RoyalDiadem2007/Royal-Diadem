/**
 * About Page admin section tests driven through the real App: real router,
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

const SECTIONS_BODY = {
  sections: [
    {
      section: 'about_org',
      title: 'Royal Diadem Rise',
      body: 'A place where young women are crowned on purpose.',
      updatedAt: '2026-07-18T12:00:00Z',
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
  listResponses: Response[];
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
            newFlags: 0,
            highSeverityNewFlags: 0,
            todaysCrownChecks: 0,
            pending: {
              openFlags: 0,
              moderation: 0,
              guardianRequests: 0,
              encouragementDrafts: 0,
              sessionRequests: 0,
              friendInvites: 0,
              upcomingEvents: 0,
            },
          }),
        );
      }
      if (target.endsWith('/admin-about/update') && init !== undefined) {
        stub.writes.push(init);
        return Promise.resolve(jsonResponse({ saved: true }));
      }
      if (target.endsWith('/admin-about')) {
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
  await user.click(within(nav).getByRole('link', { name: 'About Page' }));
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

describe('admin About Page section', () => {
  it('prefills what exists and leaves unwritten sections empty', async () => {
    const stub: FetchStub = { listResponses: [jsonResponse(SECTIONS_BODY)], writes: [] };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenSection();

    const headings = await screen.findAllByLabelText('Heading');
    expect(headings[0]).toHaveValue('Royal Diadem Rise');
    expect(headings[1]).toHaveValue('');
  });

  it('publishes the pastor bio', async () => {
    const stub: FetchStub = { listResponses: [jsonResponse(SECTIONS_BODY)], writes: [] };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenSection();
    await screen.findAllByLabelText('Heading');

    const user = userEvent.setup();
    const headings = screen.getAllByLabelText('Heading');
    const bodies = screen.getAllByLabelText('Text');
    if (headings[1] === undefined || bodies[1] === undefined) {
      throw new Error('bio editor missing');
    }
    await user.type(headings[1], 'Pastor Kenecia Duncan');
    await user.type(bodies[1], 'Founder and shepherd.');
    await user.click(screen.getByRole('button', { name: 'Publish Pastor Kenecia Duncan' }));

    await screen.findByText(/Pastor Kenecia Duncan is live on the About page/);
    const sent = stub.writes[0]?.body;
    if (typeof sent !== 'string') {
      throw new Error('publish body was not a JSON string');
    }
    expect(JSON.parse(sent)).toEqual({
      section: 'pastor_bio',
      title: 'Pastor Kenecia Duncan',
      body: 'Founder and shepherd.',
    });
  });
});
