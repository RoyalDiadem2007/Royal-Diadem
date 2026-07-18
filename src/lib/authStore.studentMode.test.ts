/**
 * Student Mode session swapping: entering parks the admin session and installs
 * the server-minted staff-student session; exiting revokes it and resumes the
 * admin session — all in memory only (CLAUDE.md §3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enterStudentMode,
  exitStudentMode,
  getSession,
  login,
  logout,
  resetAuthForTests,
} from '@/lib/authStore';

vi.mock('@/lib/turnstile', () => ({
  getTurnstileToken: vi.fn(() => Promise.resolve('turnstile-token-0123456789')),
}));

const FUTURE = '2099-01-01T00:00:00.000Z';
const PAST = '2020-01-01T00:00:00.000Z';

const ADMIN_BODY = {
  token: 'admin-opaque-token',
  expiresAt: FUTURE,
  webauthnRegistered: false,
  subject: { type: 'admin', id: 'adm-1', displayName: 'Maria', role: 'super_admin' },
};

const STUDENT_MODE_BODY = {
  token: 'staff-student-opaque-token',
  expiresAt: FUTURE,
  webauthnRegistered: false,
  staffMode: true,
  subject: { type: 'student', id: 'stu-staff-1', displayName: 'Maria (Staff)', role: 'student' },
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetchSequence(...responses: Response[]): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  for (const response of responses) {
    fn.mockResolvedValueOnce(response);
  }
  vi.stubGlobal('fetch', fn);
  return fn;
}

async function loginAsAdmin(expiresAt: string = FUTURE): Promise<ReturnType<typeof vi.fn>> {
  const fn = stubFetchSequence(json({ ...ADMIN_BODY, expiresAt }));
  const result = await login({ subjectType: 'admin', identifier: 'maria@x.org', pin: '12345678' });
  expect(result).toEqual({ ok: true });
  return fn;
}

describe('enterStudentMode', () => {
  it('swaps to the staff-student session and keeps everything out of client storage', async () => {
    await loginAsAdmin();
    const fetchMock = stubFetchSequence(json(STUDENT_MODE_BODY));

    const result = await enterStudentMode();

    expect(result).toEqual({ ok: true });
    const session = getSession();
    expect(session?.subject.type).toBe('student');
    expect(session?.subject.displayName).toBe('Maria (Staff)');
    expect(session?.staffMode).toBe(true);
    // The call was authorized with the admin token.
    const init = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe('Bearer admin-opaque-token');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).toBe('');
  });

  it('refuses without an admin session and leaves the session untouched', async () => {
    stubFetchSequence();
    const result = await enterStudentMode();
    expect(result.ok).toBe(false);
    expect(getSession()).toBeNull();
  });

  it('keeps the admin session when the server denies entry', async () => {
    await loginAsAdmin();
    stubFetchSequence(json({ error: 'forbidden' }, 403));

    const result = await enterStudentMode();

    expect(result.ok).toBe(false);
    expect(getSession()?.subject.type).toBe('admin');
  });
});

describe('exitStudentMode', () => {
  it('revokes the test session server-side and resumes the parked admin session', async () => {
    await loginAsAdmin();
    stubFetchSequence(json(STUDENT_MODE_BODY));
    await enterStudentMode();

    const fetchMock = stubFetchSequence(new Response(null, { status: 204 }));
    await exitStudentMode();

    expect(getSession()?.subject.type).toBe('admin');
    expect(getSession()?.subject.displayName).toBe('Maria');
    // The revocation used the staff-student token, not the admin one.
    const init = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe('Bearer staff-student-opaque-token');
  });

  it('signs fully out when the parked admin session has expired', async () => {
    await loginAsAdmin(PAST);
    stubFetchSequence(json(STUDENT_MODE_BODY));
    await enterStudentMode();

    stubFetchSequence(new Response(null, { status: 204 }));
    await exitStudentMode();

    expect(getSession()).toBeNull();
  });

  it('does nothing outside Student Mode', async () => {
    await loginAsAdmin();
    stubFetchSequence();
    await exitStudentMode();
    expect(getSession()?.subject.type).toBe('admin');
  });
});

describe('logout during Student Mode', () => {
  it('drops both sessions — exit afterwards cannot resurrect the admin', async () => {
    await loginAsAdmin();
    stubFetchSequence(json(STUDENT_MODE_BODY));
    await enterStudentMode();

    stubFetchSequence(new Response(null, { status: 204 }));
    await logout();
    expect(getSession()).toBeNull();

    stubFetchSequence();
    await exitStudentMode();
    expect(getSession()).toBeNull();
  });
});
