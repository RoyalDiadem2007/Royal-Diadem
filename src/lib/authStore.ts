/**
 * Auth session store. The raw session token lives HERE, in memory, and nowhere
 * else — never localStorage/sessionStorage/IndexedDB/cookies (CLAUDE.md §3:
 * no PHI/credentials in client storage). A page reload therefore requires a
 * fresh login; that is the accepted OD-1 trade-off for minors' safety.
 */
import { useSyncExternalStore } from 'react';
import { callEdgeFunction } from '@/lib/api';
import { getTurnstileToken } from '@/lib/turnstile';
import { logger } from '@/lib/logger';

export type AuthSubject = {
  type: 'student' | 'admin';
  id: string;
  displayName: string;
  role: 'student' | 'super_admin' | 'mentor' | 'viewer';
};

export type AuthSession = {
  token: string;
  expiresAt: string;
  subject: AuthSubject;
};

export type LoginInput = {
  subjectType: 'student' | 'admin';
  identifier: string;
  pin: string;
};

export type LoginResult = { ok: true } | { ok: false; message: string };

const MESSAGES: Readonly<Record<string, string>> = {
  invalid_credentials: "That code and PIN don't match. Check your card and try again.",
  consent_pending:
    "Your grown-up's permission form isn't finished yet. Ask your mentor about it — you're almost in!",
  account_inactive: 'This account is paused right now. Talk to your mentor.',
  bot_check_failed: "We couldn't confirm it's really you. Refresh the page and try again.",
  network: "Can't reach Royal Diadem right now. Check your connection and try again.",
  server: 'Something went wrong on our side. Try again in a moment.',
  turnstile: "The security check didn't load. Refresh the page and try again.",
};

function rateLimitMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many tries. Take a breath and come back in ${String(minutes)} minute${minutes === 1 ? '' : 's'}.`;
}

function parseLoginResponse(raw: unknown): AuthSession {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('login response is not an object');
  }
  const record = raw as { token?: unknown; expiresAt?: unknown; subject?: unknown };
  const subject = record.subject;
  if (
    typeof record.token !== 'string' ||
    typeof record.expiresAt !== 'string' ||
    typeof subject !== 'object' ||
    subject === null
  ) {
    throw new Error('login response is missing fields');
  }
  const s = subject as { type?: unknown; id?: unknown; displayName?: unknown; role?: unknown };
  if (
    (s.type !== 'student' && s.type !== 'admin') ||
    typeof s.id !== 'string' ||
    typeof s.displayName !== 'string' ||
    (s.role !== 'student' && s.role !== 'super_admin' && s.role !== 'mentor' && s.role !== 'viewer')
  ) {
    throw new Error('login subject is malformed');
  }
  return {
    token: record.token,
    expiresAt: record.expiresAt,
    subject: { type: s.type, id: s.id, displayName: s.displayName, role: s.role },
  };
}

let session: AuthSession | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function getSession(): AuthSession | null {
  return session;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function login(input: LoginInput): Promise<LoginResult> {
  let turnstileToken: string;
  try {
    turnstileToken = await getTurnstileToken();
  } catch {
    // Recovery = tell the user to retry; without a token the server would
    // reject the attempt anyway (fail closed).
    return { ok: false, message: MESSAGES.turnstile ?? '' };
  }

  const result = await callEdgeFunction('auth-login', {
    method: 'POST',
    body: {
      subjectType: input.subjectType,
      identifier: input.identifier.trim(),
      pin: input.pin,
      turnstileToken,
    },
    parse: parseLoginResponse,
  });

  if (!result.ok) {
    const { failure } = result;
    if (failure.kind === 'rate_limited') {
      return { ok: false, message: rateLimitMessage(failure.retryAfterSeconds) };
    }
    if (failure.kind === 'denied') {
      return {
        ok: false,
        message: MESSAGES[failure.code] ?? MESSAGES.invalid_credentials ?? '',
      };
    }
    return { ok: false, message: MESSAGES[failure.kind] ?? '' };
  }

  session = result.data;
  logger.info('auth.login_succeeded', { subjectId: result.data.subject.id });
  notify();
  return { ok: true };
}

export async function logout(): Promise<void> {
  const current = session;
  session = null;
  notify();
  if (current === null) {
    return;
  }
  // Best-effort server revocation; the in-memory token is already gone either
  // way, and the session expires server-side on its own clock.
  const result = await callEdgeFunction('auth-logout', {
    method: 'POST',
    sessionToken: current.token,
    parse: () => null,
  });
  if (!result.ok) {
    logger.warn('auth.logout_revoke_failed', { failureKind: result.failure.kind });
  }
}

/** React hook: re-renders on login/logout. */
export function useAuth(): AuthSession | null {
  return useSyncExternalStore(subscribe, getSession);
}

/** Test-only escape hatch to reset module state between tests. */
export function resetAuthForTests(): void {
  session = null;
  notify();
}
