/**
 * Relax room tests driven through the real App: real router, real auth
 * store, real components. Only fetch (the network boundary) is mocked;
 * jsdom has no AudioContext, which doubles as the graceful-absence test.
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

const LIBRARY = [
  { id: 'r-1', kind: 'affirmation', title: 'You are chosen', body: 'Crowned on purpose.' },
  { id: 'r-2', kind: 'scripture', title: 'Psalm 46:10', body: 'Be still, and know.' },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type FetchStub = { libraryResponses: Response[] };

function stubFetch(stub: FetchStub): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (target.endsWith('/auth-login')) {
        return Promise.resolve(jsonResponse(SESSION_BODY));
      }
      if (target.includes('/rest/v1/relaxation_content')) {
        const next = stub.libraryResponses.shift();
        return Promise.resolve(next ?? jsonResponse([]));
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

async function signInAndOpenRelax(): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Crown code'), 'RD-7F3K');
  await user.type(screen.getByLabelText('PIN'), '123456');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  await user.click(await screen.findByRole('link', { name: /Relax/ }));
  await screen.findByRole('heading', { name: 'Relax' });
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

describe('the Relax room', () => {
  it('starts the breathing guide on demand and stops when she feels better', async () => {
    const stub: FetchStub = { libraryResponses: [jsonResponse([])] };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenRelax();

    expect(screen.getByText('Ready when you are.')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Begin' }));
    expect(screen.getByText(/Breathe in · 4/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'I feel better' }));
    expect(screen.getByText('Ready when you are.')).toBeInTheDocument();
  });

  it('walks the 5-4-3-2-1 from five senses down to one breath', async () => {
    const stub: FetchStub = { libraryResponses: [jsonResponse([])] };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenRelax();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Start the 5·4·3·2·1' }));
    expect(screen.getByText(/five things you can see/)).toBeInTheDocument();

    for (let i = 0; i < 4; i += 1) {
      await user.click(screen.getByRole('button', { name: /Done — next|Finish/ }));
    }
    expect(screen.getByText(/thank God you’re here/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Finish' }));
    expect(screen.getByRole('button', { name: /Go again/ })).toBeInTheDocument();
  });

  it('shows the curated library under its headings, and hides sounds without audio', async () => {
    const stub: FetchStub = { libraryResponses: [jsonResponse(LIBRARY)] };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenRelax();

    expect(await screen.findByText('You are chosen')).toBeInTheDocument();
    expect(screen.getByText('Words to hold onto')).toBeInTheDocument();
    expect(screen.getByText('Psalm 46:10')).toBeInTheDocument();
    expect(screen.getByText('Scripture for still moments')).toBeInTheDocument();

    // jsdom has no AudioContext — the sounds card simply is not there.
    expect(screen.queryByLabelText('Calm sounds')).not.toBeInTheDocument();
  });

  it('keeps breathing and grounding working when the library fails', async () => {
    const stub: FetchStub = { libraryResponses: [new Response(null, { status: 500 })] };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenRelax();

    await screen.findByText(/The library couldn’t load/);
    expect(screen.getByRole('button', { name: 'Begin' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start the 5·4·3·2·1' })).toBeInTheDocument();
  });
});
