/**
 * Crown Check tests driven through the real App: real router, real auth
 * store, real component. Only fetch (the network boundary) is mocked.
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

const TODAY_ENTRY = {
  id: 'chk-1',
  checkDate: '2026-07-17',
  moodScore: 4,
  moodEmoji: '😊',
  note: 'ready for the weekend',
};

/** The JSON a test sent as a request body — never '[object Object]'. */
function sentBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== 'string') {
    throw new Error('request body was not a JSON string');
  }
  return JSON.parse(init.body) as Record<string, unknown>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type FetchStub = {
  statusResponses: Response[];
  submitResponses: Response[];
  submitCalls: RequestInit[];
};

function stubFetch(stub: FetchStub): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (target.endsWith('/auth-login')) {
        return Promise.resolve(jsonResponse(SESSION_BODY));
      }
      if (target.endsWith('/crown-check')) {
        if (init?.method === 'POST') {
          stub.submitCalls.push(init);
          const next = stub.submitResponses.shift();
          return Promise.resolve(next ?? jsonResponse({ error: 'server_error' }, 500));
        }
        const next = stub.statusResponses.shift();
        return Promise.resolve(next ?? jsonResponse({ error: 'server_error' }, 500));
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
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  resetAuthForTests();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('student Crown Check', () => {
  it('submits a first check-in with the tier emoji and the note', async () => {
    const stub: FetchStub = {
      statusResponses: [jsonResponse({ today: null, recent: [] })],
      submitResponses: [jsonResponse({ check: TODAY_ENTRY }, 201)],
      submitCalls: [],
    };
    stubFetch(stub);

    render(<App />);
    await signIn();

    const scale = await screen.findByRole('radiogroup', { name: 'How are you feeling?' });
    expect(scale).toBeInTheDocument();

    const user = userEvent.setup();
    // Nothing selected yet → submit stays disabled (no accidental empty send).
    expect(screen.getByRole('button', { name: 'Check in' })).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: /Good/ }));
    await user.type(screen.getByLabelText(/What's on your mind, queen\?/), 'ready for the weekend');
    await user.click(screen.getByRole('button', { name: 'Check in' }));

    await screen.findByText('Crown Check ✓');
    expect(screen.getByText(/feeling good today/)).toBeInTheDocument();
    expect(screen.getByText(/“ready for the weekend”/)).toBeInTheDocument();

    const sent = sentBody(stub.submitCalls[0]);
    expect(sent).toEqual({ moodScore: 4, moodEmoji: '😊', note: 'ready for the weekend' });
    const headers = new Headers(stub.submitCalls[0]?.headers);
    expect(headers.get('authorization')).toBe('Bearer raw-student-token');
  });

  it('omits the note key entirely when the note is blank', async () => {
    const stub: FetchStub = {
      statusResponses: [jsonResponse({ today: null, recent: [] })],
      submitResponses: [jsonResponse({ check: { ...TODAY_ENTRY, note: null } }, 201)],
      submitCalls: [],
    };
    stubFetch(stub);

    render(<App />);
    await signIn();
    await screen.findByRole('radiogroup', { name: 'How are you feeling?' });

    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: /Crowned/ }));
    await user.click(screen.getByRole('button', { name: 'Check in' }));

    await screen.findByText('Crown Check ✓');
    const sent = sentBody(stub.submitCalls[0]);
    expect(sent).toEqual({ moodScore: 5, moodEmoji: '👑' });
  });

  it('shows the done state on arrival and lets her update today, prefilled', async () => {
    const stub: FetchStub = {
      statusResponses: [jsonResponse({ today: TODAY_ENTRY, recent: [TODAY_ENTRY] })],
      submitResponses: [
        jsonResponse({ check: { ...TODAY_ENTRY, moodScore: 2, moodEmoji: '😟', note: null } }),
      ],
      submitCalls: [],
    };
    stubFetch(stub);

    render(<App />);
    await signIn();

    await screen.findByText('Crown Check ✓');
    expect(screen.getByText(/feeling good today/)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Feeling different? Update it' }));

    // Prefilled with what she chose earlier today.
    expect(screen.getByRole('radio', { name: /Good/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText(/What's on your mind, queen\?/)).toHaveValue(
      'ready for the weekend',
    );

    await user.click(screen.getByRole('radio', { name: /Low/ }));
    await user.clear(screen.getByLabelText(/What's on your mind, queen\?/));
    await user.click(screen.getByRole('button', { name: 'Update my check-in' }));

    await screen.findByText(/feeling low today/);
    const sent = sentBody(stub.submitCalls[0]);
    expect(sent).toEqual({ moodScore: 2, moodEmoji: '😟' });
  });

  it('shows a calm error state when loading fails and recovers via Try again', async () => {
    const stub: FetchStub = {
      statusResponses: [
        jsonResponse({ error: 'server_error' }, 500),
        jsonResponse({ today: null, recent: [] }),
      ],
      submitResponses: [],
      submitCalls: [],
    };
    stubFetch(stub);

    render(<App />);
    await signIn();

    const card = await screen.findByRole('alert');
    expect(card).toHaveTextContent("Can't reach Royal Diadem right now.");

    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('radiogroup', { name: 'How are you feeling?' });
  });

  it('keeps her on the picker with a gentle message when the submit is rate limited', async () => {
    const stub: FetchStub = {
      statusResponses: [jsonResponse({ today: null, recent: [] })],
      submitResponses: [
        new Response(JSON.stringify({ error: 'rate_limited' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
        }),
      ],
      submitCalls: [],
    };
    stubFetch(stub);

    render(<App />);
    await signIn();
    await screen.findByRole('radiogroup', { name: 'How are you feeling?' });

    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: /Okay/ }));
    await user.click(screen.getByRole('button', { name: 'Check in' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Whoa, lots of taps!');
    expect(screen.getByRole('radiogroup', { name: 'How are you feeling?' })).toBeInTheDocument();
  });

  it('treats a malformed 2xx body as a server failure, never a crash', async () => {
    const stub: FetchStub = {
      statusResponses: [jsonResponse({ unexpected: true })],
      submitResponses: [],
      submitCalls: [],
    };
    stubFetch(stub);

    render(<App />);
    await signIn();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Can't reach Royal Diadem right now.");
  });
});
