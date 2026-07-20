/**
 * Queen Card tests driven through the real App: real router, real auth
 * store, real components. Only fetch (the network boundary) is mocked.
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

const CARD_BODY = {
  profile: {
    avatarKey: null,
    avatarConfig: {
      skin: 'espresso',
      faceShape: 'oval',
      hair: 'afro',
      hairColor: 'black',
      expression: 'calm',
      crown: 'halo',
    },
    proudOf: 'I stood up for my little brother.',
  },
  goals: [
    {
      id: 'goal-1',
      title: 'Speak kindly to myself',
      nextStep: 'Name one thing I handled well today',
      status: 'growing',
      targetDate: null,
      completedAt: null,
    },
  ],
  strengths: ['brave'],
  strengthOptions: [
    { key: 'brave', label: 'Brave' },
    { key: 'creative', label: 'Creative' },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type FetchStub = {
  cardResponses: Response[];
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
      const writeAction = ['update', 'goals/create', 'goals/update', 'strengths'].find((a) =>
        target.endsWith(`/student-profile/${a}`),
      );
      if (writeAction !== undefined && init !== undefined) {
        stub.writes.push({ action: writeAction, init });
        return Promise.resolve(jsonResponse({ saved: true }));
      }
      if (target.endsWith('/student-profile')) {
        const next = stub.cardResponses.shift();
        return Promise.resolve(next ?? jsonResponse(CARD_BODY));
      }
      if (target.includes('/rest/v1/')) {
        return Promise.resolve(jsonResponse([]));
      }
      if (target.endsWith('/crown-check')) {
        return Promise.resolve(jsonResponse({ today: null, recent: [] }));
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    }),
  );
}

async function signInAndOpenCard(): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Crown code'), 'RD-7F3K');
  await user.type(screen.getByLabelText('PIN'), '123456');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  await user.click(await screen.findByRole('button', { name: 'Account menu' }));
  await user.click(screen.getByRole('menuitem', { name: 'My Queen Card' }));
  await screen.findByRole('heading', { name: /My Queen Card/ });
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

describe('My Queen Card', () => {
  it('shows her card: mark selected, proud-of, goal with status, strengths', async () => {
    const stub: FetchStub = { cardResponses: [], writes: [] };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenCard();

    // Her stored avatar loads into the builder: the matching facet swatches
    // read as selected.
    expect(screen.getByRole('radio', { name: 'Skin: Espresso' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: 'Crown: Halo' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByLabelText(/What I’m proud of/)).toHaveValue(
      'I stood up for my little brother.',
    );
    expect(screen.getByText('Speak kindly to myself')).toBeInTheDocument();
    expect(screen.getByText('Growing')).toBeInTheDocument();
    expect(screen.getByText('Name one thing I handled well today')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Brave' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Only you and the Royal Diadem staff can see it/)).toBeInTheDocument();
  });

  it('builds her avatar and saves it with proud-of together', async () => {
    const stub: FetchStub = { cardResponses: [], writes: [] };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenCard();

    const user = userEvent.setup();
    // Change three facets away from what loaded; the rest stay as stored.
    await user.click(screen.getByRole('radio', { name: 'Face shape: Heart' }));
    await user.click(screen.getByRole('radio', { name: 'Hair: Box braids' }));
    await user.click(screen.getByRole('radio', { name: 'Expression: Joyful' }));
    await user.click(screen.getByRole('button', { name: 'Save my card' }));

    await screen.findByText('Your card is saved.');
    expect(firstWrite(stub).action).toBe('update');
    expect(sentBody(firstWrite(stub).init)).toEqual({
      // The builder supersedes the legacy single mark: avatarKey is cleared.
      avatarKey: null,
      avatarConfig: {
        skin: 'espresso',
        faceShape: 'heart',
        hair: 'braids',
        hairColor: 'black',
        expression: 'joyful',
        crown: 'halo',
      },
      proudOf: 'I stood up for my little brother.',
    });
  });

  it('plants a new goal with a gentle step and target date', async () => {
    const stub: FetchStub = { cardResponses: [], writes: [] };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenCard();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Choose a goal' }));
    await user.type(screen.getByLabelText('My goal'), 'Try out for the choir');
    await user.type(screen.getByLabelText(/Next gentle step/), 'Hum one song out loud');
    await user.type(screen.getByLabelText(/Target date/), '2030-09-01');
    await user.click(screen.getByRole('button', { name: 'Plant this goal' }));

    await screen.findByText('Planted. Grow gently.');
    expect(firstWrite(stub).action).toBe('goals/create');
    expect(sentBody(firstWrite(stub).init)).toEqual({
      title: 'Try out for the choir',
      nextStep: 'Hum one song out loud',
      targetDate: '2030-09-01',
    });
  });

  it('turns the goal limit into a warm message, never an error tone', async () => {
    const stub: FetchStub = { cardResponses: [], writes: [] };
    stubFetch(stub);
    // Override the write handler for this case: the server declines politely.
    const original = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
        const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
        if (target.endsWith('/student-profile/goals/create')) {
          return Promise.resolve(jsonResponse({ error: 'goal_limit' }, 409));
        }
        return original(url, init);
      }),
    );

    render(<App />);
    await signInAndOpenCard();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Choose a goal' }));
    await user.type(screen.getByLabelText('My goal'), 'A fourth thing');
    await user.click(screen.getByRole('button', { name: 'Plant this goal' }));

    await screen.findByText(/Three growing things is a full garden/);
  });

  it("fills the home's growing-toward card from the same goals", async () => {
    const stub: FetchStub = { cardResponses: [], writes: [] };
    stubFetch(stub);

    render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Crown code'), 'RD-7F3K');
    await user.type(screen.getByLabelText('PIN'), '123456');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await screen.findByText('Speak kindly to myself');
    const aside = screen.getByRole('region', { name: "What I'm growing toward" });
    expect(aside).toHaveTextContent('Speak kindly to myself');
    expect(aside).toHaveTextContent('Growing');
    expect(aside).toHaveTextContent('Name one thing I handled well today');
    expect(screen.getByRole('link', { name: 'View my goals' })).toHaveAttribute('href', '/profile');
  });

  it('hides the strengths section entirely when no vocabulary exists', async () => {
    // Two copies: the home's goals card consumes one before the page loads.
    const empty = { ...CARD_BODY, strengths: [], strengthOptions: [] };
    const stub: FetchStub = {
      cardResponses: [jsonResponse(empty), jsonResponse(empty)],
      writes: [],
    };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenCard();

    expect(screen.queryByLabelText('My strengths')).not.toBeInTheDocument();
  });
});
