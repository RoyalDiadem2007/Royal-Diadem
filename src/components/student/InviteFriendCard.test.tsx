/**
 * "Invite a friend" card tests through the real App: real router, real auth
 * store, real component. Only fetch (the network boundary) is mocked. The
 * card's promise: a human does the outreach, and decided invites come back
 * with the address scrubbed.
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
  subject: { type: 'student', id: 'stu-1', displayName: 'Maya', role: 'student' },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type FetchStub = {
  listResponses: Response[];
  createResponses: Response[];
  createBodies: RequestInit[];
};

function stubFetch(stub: FetchStub): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (target.endsWith('/auth-login')) {
        return Promise.resolve(jsonResponse(SESSION_BODY));
      }
      if (target.endsWith('/friend-invites/create') && init !== undefined) {
        stub.createBodies.push(init);
        const next = stub.createResponses.shift();
        return Promise.resolve(next ?? jsonResponse({ error: 'server_error' }, 500));
      }
      if (target.endsWith('/friend-invites')) {
        const next = stub.listResponses.shift();
        return Promise.resolve(next ?? jsonResponse({ invites: [] }));
      }
      if (target.endsWith('/mentor-sessions')) {
        return Promise.resolve(jsonResponse({ requests: [] }));
      }
      if (target.endsWith('/student-guardian-requests')) {
        return Promise.resolve(jsonResponse({ requests: [] }));
      }
      if (target.endsWith('/crown-check')) {
        return Promise.resolve(jsonResponse({ today: null, recent: [] }));
      }
      if (target.endsWith('/student-profile')) {
        return Promise.resolve(
          jsonResponse({
            profile: { avatarKey: null, proudOf: null },
            goals: [],
            strengths: [],
            strengthOptions: [],
          }),
        );
      }
      if (target.includes('/rest/v1/')) {
        return Promise.resolve(jsonResponse([]));
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
  await screen.findByRole('heading', { name: /Maya/ });
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

describe('invite a friend card', () => {
  it('sends the address to her team and shows it waiting', async () => {
    const stub: FetchStub = {
      listResponses: [
        jsonResponse({ invites: [] }),
        jsonResponse({
          invites: [
            {
              id: 'inv-1',
              email: 'friend@example.com',
              status: 'pending',
              createdAt: '2026-07-19T10:00:00Z',
            },
          ],
        }),
      ],
      createResponses: [jsonResponse({ inviteId: 'inv-1' }, 201)],
      createBodies: [],
    };
    stubFetch(stub);

    render(<App />);
    await signIn();

    await screen.findByLabelText('Invite a friend');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Her email'), 'friend@example.com');
    await user.click(screen.getByRole('button', { name: 'Share with my team' }));

    await screen.findByText('Got it — a real person from your team will reach out to them. 💛');
    expect(sentBody(stub.createBodies[0])).toEqual({ email: 'friend@example.com' });
    await screen.findByText('friend@example.com');
    expect(screen.getByText('With our team')).toBeInTheDocument();
  });

  it('shows decided invites scrubbed — no address, just the soft status', async () => {
    stubFetch({
      listResponses: [
        jsonResponse({
          invites: [
            { id: 'inv-2', email: null, status: 'reached_out', createdAt: '2026-07-18T10:00:00Z' },
            { id: 'inv-3', email: null, status: 'declined', createdAt: '2026-07-17T10:00:00Z' },
          ],
        }),
      ],
      createResponses: [],
      createBodies: [],
    });

    render(<App />);
    await signIn();

    const card = await screen.findByLabelText('Invite a friend');
    await screen.findByText('Our team reached out');
    expect(screen.getByText('Not sent this time')).toBeInTheDocument();
    expect(card).not.toHaveTextContent('@');
    expect(screen.getAllByText('A friend')).toHaveLength(2);
  });

  it('answers a repeat invite honestly without resending', async () => {
    const stub: FetchStub = {
      listResponses: [jsonResponse({ invites: [] })],
      createResponses: [jsonResponse({ error: 'already_invited' }, 409)],
      createBodies: [],
    };
    stubFetch(stub);

    render(<App />);
    await signIn();

    await screen.findByLabelText('Invite a friend');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Her email'), 'friend@example.com');
    await user.click(screen.getByRole('button', { name: 'Share with my team' }));

    await screen.findByText('You’ve already told us about this friend — your team has it. 💛');
  });
});
