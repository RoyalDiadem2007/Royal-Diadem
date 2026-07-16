import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getSession,
  login,
  loginWithPasskey,
  registerPasskey,
  resetAuthForTests,
} from '@/lib/authStore';
import { passkeysSupported, performAuthentication, performRegistration } from '@/lib/passkey';

vi.mock('@/lib/turnstile', () => ({
  getTurnstileToken: vi.fn(() => Promise.resolve('turnstile-token-0123456789')),
}));

// The platform authenticator (Face ID / Touch ID) is a true external boundary
// in jsdom — there is no virtual authenticator — so the passkey module is the
// one mocked seam. Everything else (store logic, HTTP layer) runs for real.
vi.mock('@/lib/passkey', () => ({
  passkeysSupported: vi.fn(() => true),
  performAuthentication: vi.fn(),
  performRegistration: vi.fn(),
}));

const SESSION_BODY = {
  token: 'raw-opaque-token',
  expiresAt: '2026-07-17T00:00:00.000Z',
  webauthnRegistered: false,
  subject: { type: 'student', id: 'stu-1', displayName: 'Jada', role: 'student' },
};

const AUTH_OPTIONS_BODY = { options: { challenge: 'chal-abc', rpId: 'localhost' } };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
  vi.mocked(passkeysSupported).mockReturnValue(true);
});

afterEach(() => {
  resetAuthForTests();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('loginWithPasskey', () => {
  it('completes the ceremony and stores the session in memory only', async () => {
    vi.mocked(performAuthentication).mockResolvedValueOnce({
      challenge: 'chal-abc',
      response: { id: 'cred-1', rawId: 'cred-1', response: {}, type: 'public-key' } as never,
    });
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (target.endsWith('/auth-webauthn-login/options')) {
        return Promise.resolve(jsonResponse(AUTH_OPTIONS_BODY));
      }
      return Promise.resolve(jsonResponse({ ...SESSION_BODY, webauthnRegistered: true }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await loginWithPasskey();

    expect(result).toEqual({ ok: true });
    expect(getSession()?.subject.displayName).toBe('Jada');
    expect(getSession()?.webauthnRegistered).toBe(true);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);

    // The verify call carried the ceremony's challenge back to the server.
    const verifyCall = fetchMock.mock.calls.find(([u]) => {
      const target = typeof u === 'string' ? u : u instanceof URL ? u.href : u.url;
      return target.endsWith('/auth-webauthn-login/verify');
    });
    expect(verifyCall).toBeDefined();
  });

  it('reports a friendly message when the user cancels the platform prompt', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(AUTH_OPTIONS_BODY))),
    );
    vi.mocked(performAuthentication).mockRejectedValueOnce(new Error('NotAllowedError'));

    const result = await loginWithPasskey();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('cancelled');
    }
    expect(getSession()).toBeNull();
  });

  it('refuses politely on devices without passkey support', async () => {
    vi.mocked(passkeysSupported).mockReturnValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await loginWithPasskey();

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('registerPasskey', () => {
  it('enrolls a passkey for the signed-in user and flips the session flag', async () => {
    // Real PIN login first so the store holds a genuine session.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(SESSION_BODY))),
    );
    await login({ subjectType: 'student', identifier: 'RD-7F3K', pin: '123456' });
    expect(getSession()?.webauthnRegistered).toBe(false);

    vi.mocked(performRegistration).mockResolvedValueOnce({
      challenge: 'chal-reg',
      response: { id: 'cred-2', rawId: 'cred-2', response: {}, type: 'public-key' } as never,
    });
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (target.endsWith('/auth-webauthn-register/options')) {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        expect(headers.Authorization).toBe('Bearer raw-opaque-token');
        return Promise.resolve(jsonResponse(AUTH_OPTIONS_BODY));
      }
      return Promise.resolve(jsonResponse({ registered: true }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await registerPasskey();

    expect(result).toEqual({ ok: true });
    expect(getSession()?.webauthnRegistered).toBe(true);
  });

  it('fails without a session instead of calling the server', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await registerPasskey();

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
