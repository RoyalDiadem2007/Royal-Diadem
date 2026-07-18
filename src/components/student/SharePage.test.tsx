/**
 * Royal Diadem Share page tests driven through the real App: real router,
 * real auth store, real component. Only fetch (the network boundary) and
 * the Turnstile widget are mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

const REACTION_SET = ['👑', '💎', '🦩', '👏', '✨', '💪', '🌹', '🎉', '💖', '🔥'];

const FEED_BODY = {
  posts: [
    {
      id: 'post-mine',
      authorName: 'Jada',
      mine: true,
      contentText: 'I finished my first week!',
      status: 'pending',
      createdAt: '2026-07-18T15:00:00Z',
      comments: [],
      reactions: {},
      myReactions: [],
    },
    {
      id: 'post-amber',
      authorName: 'Amber',
      mine: false,
      contentText: 'Crowned and confident today.',
      status: 'approved',
      createdAt: '2026-07-17T15:00:00Z',
      comments: [
        {
          id: 'cmt-1',
          authorName: 'Nia',
          mine: false,
          text: 'You deserve it, queen!',
          status: 'approved',
          createdAt: '2026-07-17T16:00:00Z',
        },
      ],
      reactions: { '👑': 2 },
      myReactions: ['👑'],
    },
  ],
  page: 1,
  pageSize: 20,
  total: 2,
  reactionSet: REACTION_SET,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type FetchStub = {
  feedResponses: Response[];
  writes: { action: string; init: RequestInit }[];
};

function stubFetch(stub: FetchStub): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (target.endsWith('/auth-login')) {
        return Promise.resolve(jsonResponse(SESSION_BODY));
      }
      const writeAction = ['post', 'comment', 'react', 'flag'].find((a) =>
        target.endsWith(`/share/${a}`),
      );
      if (writeAction !== undefined && init !== undefined) {
        stub.writes.push({ action: writeAction, init });
        if (writeAction === 'post') {
          return Promise.resolve(
            jsonResponse(
              { post: { id: 'post-new', status: 'pending', createdAt: '2026-07-18T16:00:00Z' } },
              201,
            ),
          );
        }
        if (writeAction === 'comment') {
          return Promise.resolve(
            jsonResponse(
              {
                comment: { id: 'cmt-new', status: 'pending', createdAt: '2026-07-18T16:00:00Z' },
              },
              201,
            ),
          );
        }
        if (writeAction === 'react') {
          return Promise.resolve(jsonResponse({ reacted: true }));
        }
        return Promise.resolve(jsonResponse({ received: true }));
      }
      if (target.includes('/share?page=')) {
        const next = stub.feedResponses.shift();
        return Promise.resolve(next ?? jsonResponse(FEED_BODY));
      }
      if (target.includes('/rest/v1/')) {
        // Passive home cards stay quietly empty.
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

async function signInAndOpenShare(): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Crown code'), 'RD-7F3K');
  await user.type(screen.getByLabelText('PIN'), '123456');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  await user.click(await screen.findByRole('link', { name: /Royal Diadem Share/ }));
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

describe('Royal Diadem Share page', () => {
  it('shows the feed with reactions and labels my pending post for me only', async () => {
    const stub: FetchStub = { feedResponses: [], writes: [] };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenShare();

    await screen.findByText('Crowned and confident today.');
    expect(screen.getByText('I finished my first week!')).toBeInTheDocument();
    expect(screen.getByText(/Waiting for review — only you see this/)).toBeInTheDocument();
    expect(screen.getByText('You deserve it, queen!')).toBeInTheDocument();

    // My existing 👑 reaction is marked pressed and shows its count.
    const amberPost = screen.getByRole('article', { name: 'Post by Amber' });
    const crown = screen
      .getAllByRole('button', { name: 'React 👑' })
      .find((b) => b.getAttribute('aria-pressed') === 'true');
    expect(crown).toBeDefined();
    expect(amberPost).toHaveTextContent('2');
  });

  it('sends a post with the Turnstile token and shows the review notice', async () => {
    const stub: FetchStub = { feedResponses: [], writes: [] };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenShare();
    await screen.findByText('Crowned and confident today.');

    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText('What are you celebrating today?'),
      'My mom came to visit!',
    );
    await user.click(screen.getByRole('button', { name: 'Share it' }));

    await screen.findByText(/An admin will take a quick look/);
    expect(firstWrite(stub).action).toBe('post');
    expect(sentBody(firstWrite(stub).init)).toEqual({
      contentText: 'My mom came to visit!',
      turnstileToken: 'turnstile-token-0123456789',
    });
    const headers = new Headers(firstWrite(stub).init.headers);
    expect(headers.get('authorization')).toBe('Bearer raw-student-token');
  });

  it('comments on an approved post', async () => {
    const stub: FetchStub = { feedResponses: [], writes: [] };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenShare();
    await screen.findByText('Crowned and confident today.');

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Comment on Amber's post"), 'So proud of you!');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await screen.findByText('Comment sent.');
    expect(firstWrite(stub).action).toBe('comment');
    expect(sentBody(firstWrite(stub).init)).toEqual({
      postId: 'post-amber',
      commentText: 'So proud of you!',
    });
  });

  it('flags a post only after the anonymous confirmation', async () => {
    const stub: FetchStub = { feedResponses: [], writes: [] };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenShare();
    await screen.findByText('Crowned and confident today.');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Something doesn’t feel right' }));
    expect(stub.writes).toHaveLength(0);
    expect(screen.getByText(/No one else will know it was you/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Yes, tell an admin' }));
    await screen.findByText(/Thank you for saying something/);
    expect(firstWrite(stub).action).toBe('flag');
    expect(sentBody(firstWrite(stub).init)).toEqual({
      entityType: 'post',
      entityId: 'post-amber',
    });
  });
});
