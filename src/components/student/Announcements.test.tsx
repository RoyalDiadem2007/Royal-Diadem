/**
 * Announcements card tests driven through the real App: real router, real
 * auth store, real component. Only fetch (the network boundary) is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { resetAuthForTests } from '@/lib/authStore';

vi.mock('@/lib/turnstile', () => ({
  getTurnstileToken: vi.fn(() => Promise.resolve('turnstile-token-0123456789')),
}));

const SESSION_BODY = {
  token: 'raw-student-token',
  expiresAt: '2026-07-18T00:00:00.000Z',
  subject: { type: 'student', id: 'stu-1', displayName: 'Jada', role: 'student' },
};

const FEED = [
  {
    id: 'ann-2',
    title: 'Retreat sign-ups open',
    body: 'Grab your spot before Friday!',
    priority: 'urgent',
    created_at: '2026-07-18T15:00:00Z',
  },
  {
    id: 'ann-1',
    title: 'New journal prompts',
    body: 'Fresh prompts are waiting for you.',
    priority: 'normal',
    created_at: '2026-07-16T12:00:00Z',
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type FetchStub = {
  feedResponses: Response[];
  markReadCalls: RequestInit[];
};

function stubFetch(stub: FetchStub): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (target.endsWith('/auth-login')) {
        return Promise.resolve(jsonResponse(SESSION_BODY));
      }
      if (target.includes('/rest/v1/announcements')) {
        const next = stub.feedResponses.shift();
        return Promise.resolve(next ?? jsonResponse([]));
      }
      if (target.endsWith('/announcement-reads')) {
        if (init !== undefined) {
          stub.markReadCalls.push(init);
        }
        return Promise.resolve(jsonResponse({ marked: 2 }));
      }
      if (target.includes('/rest/v1/')) {
        // Other passive cards (daily message, events) stay quietly empty.
        return Promise.resolve(jsonResponse([]));
      }
      if (target.endsWith('/crown-check')) {
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

describe('student Announcements card', () => {
  it('shows the feed newest-first with urgent emphasis and records receipts', async () => {
    const stub: FetchStub = { feedResponses: [jsonResponse(FEED)], markReadCalls: [] };
    stubFetch(stub);

    render(<App />);
    await signIn();

    await screen.findByText('Retreat sign-ups open');
    expect(screen.getByText('New journal prompts')).toBeInTheDocument();
    expect(screen.getByText('Urgent')).toBeInTheDocument();

    // Receipts go through the Edge Function with her session, both ids.
    await waitFor(() => {
      expect(stub.markReadCalls).toHaveLength(1);
    });
    const call = stub.markReadCalls[0];
    if (typeof call?.body !== 'string') {
      throw new Error('mark-read body was not a JSON string');
    }
    expect(JSON.parse(call.body)).toEqual({ announcementIds: ['ann-2', 'ann-1'] });
    const headers = new Headers(call.headers);
    expect(headers.get('authorization')).toBe('Bearer raw-student-token');
  });

  it('renders nothing at all when no announcements exist', async () => {
    const stub: FetchStub = { feedResponses: [jsonResponse([])], markReadCalls: [] };
    stubFetch(stub);

    render(<App />);
    await signIn();

    await screen.findByRole('radiogroup', { name: 'How are you feeling?' });
    expect(screen.queryByLabelText('Announcements')).not.toBeInTheDocument();
    expect(stub.markReadCalls).toHaveLength(0);
  });

  it('shows a quiet error with retry, and recovers when retry succeeds', async () => {
    const stub: FetchStub = {
      feedResponses: [new Response(null, { status: 500 }), jsonResponse(FEED)],
      markReadCalls: [],
    };
    stubFetch(stub);

    render(<App />);
    await signIn();

    await screen.findByText(/Announcements couldn’t load/);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await screen.findByText('Retreat sign-ups open');
    expect(screen.queryByText(/couldn’t load/)).not.toBeInTheDocument();
  });
});
