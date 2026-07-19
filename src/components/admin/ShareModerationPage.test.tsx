/**
 * Share Moderation section tests driven through the real App: real router,
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

const QUEUE_BODY = {
  mode: 'pre',
  posts: [
    {
      id: 'post-1',
      authorName: 'Jada',
      text: 'I finished my first week!',
      imageUrl: 'https://example.supabase.co/storage/v1/object/sign/share-media/jada.jpg?token=t',
      createdAt: '2026-07-18T15:00:00Z',
      flag: null,
    },
    {
      id: 'post-2',
      authorName: 'Amber',
      text: 'Something a peer worried about.',
      imageUrl: null,
      createdAt: '2026-07-18T14:00:00Z',
      flag: { flaggedBy: 'Nia', flaggedAt: '2026-07-18T14:30:00Z' },
    },
  ],
  comments: [],
  page: 1,
  pageSize: 25,
  totalPosts: 2,
  totalComments: 0,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type FetchStub = {
  queueResponses: Response[];
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
      const writeAction = ['moderate', 'mode'].find((a) => target.endsWith(`/admin-share/${a}`));
      if (writeAction !== undefined && init !== undefined) {
        stub.writes.push({ action: writeAction, init });
        return Promise.resolve(
          jsonResponse(writeAction === 'mode' ? { mode: 'post' } : { status: 'approved' }),
        );
      }
      if (target.includes('/admin-share')) {
        const next = stub.queueResponses.shift();
        return Promise.resolve(next ?? jsonResponse(QUEUE_BODY));
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
  await user.click(within(nav).getByRole('link', { name: 'Share Moderation' }));
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

describe('admin Share Moderation section', () => {
  it('shows the queue with peer-flag attribution for admins only', async () => {
    const stub: FetchStub = { queueResponses: [jsonResponse(QUEUE_BODY)], writes: [] };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenSection();

    await screen.findByText('I finished my first week!');
    expect(screen.getByText('Something a peer worried about.')).toBeInTheDocument();
    expect(screen.getByText(/Peer-flagged by Nia/)).toBeInTheDocument();
    expect(screen.getByText(/Pending posts \(2\)/)).toBeInTheDocument();

    // The pending photo is visible to the reviewer via its signed URL.
    const img = screen.getByRole('img', { name: 'Pending photo from Jada' });
    expect(img).toHaveAttribute('src', expect.stringContaining('/object/sign/share-media/'));
  });

  it('approves a pending post', async () => {
    const stub: FetchStub = {
      queueResponses: [jsonResponse(QUEUE_BODY), jsonResponse(QUEUE_BODY)],
      writes: [],
    };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenSection();
    await screen.findByText('I finished my first week!');

    const user = userEvent.setup();
    const approveButtons = screen.getAllByRole('button', { name: 'Approve' });
    if (approveButtons[0] === undefined) {
      throw new Error('no approve button rendered');
    }
    await user.click(approveButtons[0]);

    await screen.findByText(/Approved — it’s visible to the girls now/);
    expect(firstWrite(stub).action).toBe('moderate');
    expect(sentBody(firstWrite(stub).init)).toEqual({
      entityType: 'post',
      entityId: 'post-1',
      action: 'approve',
    });
  });

  it('removes with an optional note after confirmation', async () => {
    const stub: FetchStub = {
      queueResponses: [jsonResponse(QUEUE_BODY), jsonResponse(QUEUE_BODY)],
      writes: [],
    };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenSection();
    await screen.findByText('Something a peer worried about.');

    const user = userEvent.setup();
    const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
    if (removeButtons[1] === undefined) {
      throw new Error('expected two remove buttons');
    }
    await user.click(removeButtons[1]);
    expect(stub.writes).toHaveLength(0);

    await user.type(screen.getByLabelText(/Note \(optional/), 'Talked with Amber one on one.');
    await user.click(screen.getByRole('button', { name: 'Confirm remove' }));

    await screen.findByText(/Removed\. Any open peer flag on it is resolved\./);
    expect(sentBody(firstWrite(stub).init)).toEqual({
      entityType: 'post',
      entityId: 'post-2',
      action: 'remove',
      note: 'Talked with Amber one on one.',
    });
  });

  it('switches the moderation mode', async () => {
    const stub: FetchStub = {
      queueResponses: [jsonResponse(QUEUE_BODY), jsonResponse({ ...QUEUE_BODY, mode: 'post' })],
      writes: [],
    };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenSection();
    await screen.findByText('I finished my first week!');

    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/Post-approve/));

    await screen.findByText(/Post-approval on/);
    expect(firstWrite(stub).action).toBe('mode');
    expect(sentBody(firstWrite(stub).init)).toEqual({ mode: 'post' });
  });
});
