import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSession, login, logout, resetAuthForTests } from '@/lib/authStore';

vi.mock('@/lib/turnstile', () => ({
  getTurnstileToken: vi.fn(() => Promise.resolve('turnstile-token-0123456789')),
}));

const SESSION_BODY = {
  token: 'raw-opaque-token',
  expiresAt: '2026-07-17T00:00:00.000Z',
  subject: { type: 'student', id: 'stu-1', displayName: 'Jada', role: 'student' },
};

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
});

afterEach(() => {
  resetAuthForTests();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetchOnce(response: Response): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(response));
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('authStore', () => {
  it('stores a successful session in memory only — never client storage', async () => {
    stubFetchOnce(
      new Response(JSON.stringify(SESSION_BODY), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await login({ subjectType: 'student', identifier: 'RD-7F3K', pin: '123456' });

    expect(result).toEqual({ ok: true });
    expect(getSession()?.subject.displayName).toBe('Jada');
    // CLAUDE.md §3 hard gate: nothing auth-related may touch client storage.
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).toBe('');
  });

  it('returns a friendly message for wrong credentials and stays logged out', async () => {
    stubFetchOnce(new Response(JSON.stringify({ error: 'invalid_credentials' }), { status: 401 }));

    const result = await login({ subjectType: 'student', identifier: 'RD-7F3K', pin: '000000' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("don't match");
    }
    expect(getSession()).toBeNull();
  });

  it('surfaces the COPPA consent gate with guardian-friendly wording', async () => {
    stubFetchOnce(new Response(JSON.stringify({ error: 'consent_pending' }), { status: 403 }));

    const result = await login({ subjectType: 'student', identifier: 'RD-7F3K', pin: '123456' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('permission form');
    }
  });

  it('turns a rate limit into a wait message with minutes', async () => {
    stubFetchOnce(new Response(null, { status: 429, headers: { 'Retry-After': '900' } }));

    const result = await login({ subjectType: 'student', identifier: 'RD-7F3K', pin: '123456' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('15 minute');
    }
  });

  it('fails gracefully when the Turnstile challenge cannot be obtained', async () => {
    const { getTurnstileToken } = await import('@/lib/turnstile');
    vi.mocked(getTurnstileToken).mockRejectedValueOnce(new Error('script blocked'));
    const fetchMock = stubFetchOnce(new Response(null, { status: 500 }));

    const result = await login({ subjectType: 'student', identifier: 'RD-7F3K', pin: '123456' });

    expect(result.ok).toBe(false);
    // Without a bot-check token we never even hit the server.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logout clears the session immediately and revokes it server-side', async () => {
    stubFetchOnce(
      new Response(JSON.stringify(SESSION_BODY), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await login({ subjectType: 'student', identifier: 'RD-7F3K', pin: '123456' });

    const fetchMock = stubFetchOnce(new Response(null, { status: 204 }));
    await logout();

    expect(getSession()).toBeNull();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/functions/v1/auth-logout');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer raw-opaque-token');
  });
});
