/**
 * Strengths vocabulary tests driven through the real App: real router,
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

const OPTIONS_BODY = {
  options: [
    { key: 'brave', label: 'Brave', active: true },
    { key: 'quiet-fire', label: 'Quiet Fire', active: false },
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
      const writeAction = ['create', 'toggle'].find((a) =>
        target.endsWith(`/admin-strengths/${a}`),
      );
      if (writeAction !== undefined && init !== undefined) {
        stub.writes.push({ action: writeAction, init });
        return Promise.resolve(jsonResponse({ saved: true }, writeAction === 'create' ? 201 : 200));
      }
      if (target.includes('/admin-strengths')) {
        const next = stub.listResponses.shift();
        return Promise.resolve(next ?? jsonResponse(OPTIONS_BODY));
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
  await user.click(within(nav).getByRole('link', { name: 'Strengths' }));
}

function sentBody(init: RequestInit): Record<string, unknown> {
  if (typeof init.body !== 'string') {
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

describe('admin Strengths vocabulary', () => {
  it('lists words with the retired mark', async () => {
    const stub: FetchStub = { listResponses: [], writes: [] };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenSection();

    expect(await screen.findByText('Brave')).toBeInTheDocument();
    expect(screen.getByText('Quiet Fire')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
  });

  it('adds a word with a derived key', async () => {
    const stub: FetchStub = { listResponses: [], writes: [] };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenSection();
    await screen.findByText('Brave');

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('New strength word'), 'Quick Thinker');
    await user.click(screen.getByRole('button', { name: 'Add word' }));

    await screen.findByText(/added to the vocabulary/);
    const write = stub.writes[0];
    if (write === undefined) {
      throw new Error('no write captured');
    }
    expect(write.action).toBe('create');
    expect(sentBody(write.init)).toEqual({ key: 'quick-thinker', label: 'Quick Thinker' });
  });

  it('retires a word from new picks', async () => {
    const stub: FetchStub = { listResponses: [], writes: [] };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenSection();
    await screen.findByText('Brave');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Retire' }));

    await screen.findByText('Retired from new picks.');
    const write = stub.writes[0];
    if (write === undefined) {
      throw new Error('no write captured');
    }
    expect(write.action).toBe('toggle');
    expect(sentBody(write.init)).toEqual({ key: 'brave', active: false });
  });
});
