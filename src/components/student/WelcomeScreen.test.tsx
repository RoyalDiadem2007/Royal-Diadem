/**
 * /welcome magic-link claim tests driven through the real App: real router,
 * real auth store, real component. Only fetch (the network boundary) is
 * mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { resetAuthForTests } from '@/lib/authStore';
import { tokenFromFragment } from '@/lib/linkToken';

vi.mock('@/lib/turnstile', () => ({
  getTurnstileToken: vi.fn(() => Promise.resolve('turnstile-token-0123456789')),
}));

const LINK_TOKEN = 'a'.repeat(43);

const CLAIM_BODY = {
  token: 'raw-student-token',
  expiresAt: '2026-07-18T00:00:00.000Z',
  webauthnRegistered: false,
  subject: { type: 'student', id: 'stu-1', displayName: 'Jada', role: 'student' },
  credentials: { crownCode: 'RD-7F3K', pin: '481516' },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type FetchStub = { claimResponses: Response[]; claimCalls: RequestInit[] };

function stubFetch(stub: FetchStub): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (target.endsWith('/magic-link-claim')) {
        stub.claimCalls.push(init ?? {});
        const next = stub.claimResponses.shift();
        return Promise.resolve(next ?? jsonResponse({ error: 'server_error' }, 500));
      }
      if (target.includes('/rest/v1/')) {
        // Empty Data API reads — the passive content cards stay hidden.
        return Promise.resolve(jsonResponse([]));
      }
      if (target.endsWith('/student-profile')) {
        // The goals card stays in its gentle empty state.
        return Promise.resolve(
          jsonResponse({
            profile: { avatarKey: null, proudOf: null },
            goals: [],
            strengths: [],
            strengthOptions: [],
          }),
        );
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    }),
  );
}

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
});

afterEach(() => {
  resetAuthForTests();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('tokenFromFragment', () => {
  it('extracts a well-formed token and rejects everything else', () => {
    expect(tokenFromFragment(`#t=${LINK_TOKEN}`)).toBe(LINK_TOKEN);
    expect(tokenFromFragment('')).toBeNull();
    expect(tokenFromFragment('#t=short')).toBeNull();
    expect(tokenFromFragment(`#t=${LINK_TOKEN}&x=1`)).toBeNull();
  });
});

describe('welcome magic-link claim (OD-19)', () => {
  it('claims on an explicit tap, reveals credentials once, then enters the app', async () => {
    window.history.replaceState(null, '', `/welcome#t=${LINK_TOKEN}`);
    const stub: FetchStub = { claimResponses: [jsonResponse(CLAIM_BODY)], claimCalls: [] };
    stubFetch(stub);

    render(<App />);
    // Landing: nothing claimed yet, no credentials anywhere.
    expect(screen.queryByText('RD-7F3K')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Get my sign-in code' }));

    // The one-time reveal: crown code + fresh PIN.
    expect(await screen.findByText('RD-7F3K')).toBeInTheDocument();
    expect(screen.getByText('481516')).toBeInTheDocument();

    const sentBody = stub.claimCalls[0]?.body;
    if (typeof sentBody !== 'string') {
      throw new Error('claim body was not a JSON string');
    }
    expect(JSON.parse(sentBody)).toEqual({
      token: LINK_TOKEN,
      turnstileToken: 'turnstile-token-0123456789',
    });

    await user.click(screen.getByRole('button', { name: 'I saved them — take me in' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        /Good (morning|afternoon|evening), Jada/,
      );
    });
  });

  it('explains a used or expired link without leaking token state', async () => {
    window.history.replaceState(null, '', `/welcome#t=${LINK_TOKEN}`);
    const stub: FetchStub = {
      claimResponses: [jsonResponse({ error: 'invalid_link' }, 401)],
      claimCalls: [],
    };
    stubFetch(stub);

    render(<App />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Get my sign-in code' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('already been used or has expired');
    expect(screen.getByRole('link', { name: 'Go to sign-in' })).toBeInTheDocument();
  });

  it('surfaces the consent gate for an under-13 whose consent is not verified', async () => {
    window.history.replaceState(null, '', `/welcome#t=${LINK_TOKEN}`);
    const stub: FetchStub = {
      claimResponses: [jsonResponse({ error: 'consent_pending' }, 403)],
      claimCalls: [],
    };
    stubFetch(stub);

    render(<App />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Get my sign-in code' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('permission form');
  });

  it('reveals guardian credentials (email + PIN) for a guardian portal claim', async () => {
    window.history.replaceState(null, '', `/welcome#t=${LINK_TOKEN}`);
    const stub: FetchStub = {
      claimResponses: [
        jsonResponse({
          token: 'raw-guardian-token',
          expiresAt: '2026-07-18T00:00:00.000Z',
          webauthnRegistered: false,
          subject: { type: 'guardian', id: 'acct-1', displayName: 'Rae Linked', role: 'guardian' },
          credentials: { loginEmail: 'rae@example.com', pin: '135791' },
        }),
      ],
      claimCalls: [],
    };
    stubFetch(stub);

    render(<App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Get my sign-in code' }));

    expect(await screen.findByText('rae@example.com')).toBeInTheDocument();
    expect(screen.getByText('135791')).toBeInTheDocument();
    // Guardian copy — the ceremony promise, not the Face ID pitch.
    expect(screen.getByText(/a code she shares from her app/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'I saved them — take me in' }));
    expect(await screen.findByRole('heading', { name: 'Hello, Rae Linked' })).toBeInTheDocument();
  });

  it('asks for the email link when the page is opened without a token', () => {
    window.history.replaceState(null, '', '/welcome');
    stubFetch({ claimResponses: [], claimCalls: [] });

    render(<App />);
    expect(screen.getByRole('alert')).toHaveTextContent('needs the link from your email');
    expect(screen.queryByRole('button', { name: 'Get my sign-in code' })).not.toBeInTheDocument();
  });
});
