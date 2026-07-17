/**
 * Auth session store. The raw session token lives HERE, in memory, and nowhere
 * else — never localStorage/sessionStorage/IndexedDB/cookies (CLAUDE.md §3:
 * no PHI/credentials in client storage). A page reload therefore requires a
 * fresh login; that is the accepted OD-1 trade-off for minors' safety.
 */
import { useSyncExternalStore } from 'react';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { callEdgeFunction, type ApiFailure } from '@/lib/api';
import { getTurnstileToken } from '@/lib/turnstile';
import { passkeysSupported, performAuthentication, performRegistration } from '@/lib/passkey';
import { logger } from '@/lib/logger';

export type AuthSubject = {
  type: 'student' | 'admin' | 'guardian';
  id: string;
  displayName: string;
  role: 'student' | 'super_admin' | 'mentor' | 'viewer' | 'guardian';
};

export type AuthSession = {
  token: string;
  expiresAt: string;
  subject: AuthSubject;
  /** Whether this account already has a passkey — drives the enable prompt. */
  webauthnRegistered: boolean;
};

export type LoginInput = {
  subjectType: 'student' | 'admin' | 'guardian';
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
  passkey_unsupported: "This device doesn't support Face ID / passkey sign-in. Use your PIN.",
  passkey_cancelled: 'Face ID sign-in was cancelled. Try again, or use your PIN.',
  account_unavailable: 'This account cannot sign in right now. Talk to your mentor or an admin.',
  invalid_challenge: 'That sign-in attempt expired. Try again.',
  invalid_link:
    'This welcome link has already been used or has expired. Ask your mentor to send a fresh one.',
};

function failureMessage(failure: ApiFailure): string {
  if (failure.kind === 'rate_limited') {
    return rateLimitMessage(failure.retryAfterSeconds);
  }
  if (failure.kind === 'denied') {
    return MESSAGES[failure.code] ?? MESSAGES.invalid_credentials ?? '';
  }
  return MESSAGES[failure.kind] ?? '';
}

function rateLimitMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many tries. Take a breath and come back in ${String(minutes)} minute${minutes === 1 ? '' : 's'}.`;
}

function parseLoginResponse(raw: unknown): AuthSession {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('login response is not an object');
  }
  const record = raw as {
    token?: unknown;
    expiresAt?: unknown;
    subject?: unknown;
    webauthnRegistered?: unknown;
  };
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
    (s.type !== 'student' && s.type !== 'admin' && s.type !== 'guardian') ||
    typeof s.id !== 'string' ||
    typeof s.displayName !== 'string' ||
    (s.role !== 'student' &&
      s.role !== 'super_admin' &&
      s.role !== 'mentor' &&
      s.role !== 'viewer' &&
      s.role !== 'guardian')
  ) {
    throw new Error('login subject is malformed');
  }
  return {
    token: record.token,
    expiresAt: record.expiresAt,
    subject: { type: s.type, id: s.id, displayName: s.displayName, role: s.role },
    webauthnRegistered: record.webauthnRegistered === true,
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
    return { ok: false, message: failureMessage(result.failure) };
  }

  session = result.data;
  logger.info('auth.login_succeeded', { subjectId: result.data.subject.id });
  notify();
  return { ok: true };
}

function checkedCeremonyOptions(raw: unknown): object {
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !('options' in raw) ||
    typeof raw.options !== 'object' ||
    raw.options === null ||
    !('challenge' in raw.options) ||
    typeof raw.options.challenge !== 'string'
  ) {
    throw new Error('ceremony options are malformed');
  }
  return raw.options;
}

// The options blobs are opaque WebAuthn JSON consumed (and fully validated)
// by @simplewebauthn/browser; we check the envelope + challenge and pass the
// rest through.
function parseRegistrationOptions(raw: unknown): PublicKeyCredentialCreationOptionsJSON {
  return checkedCeremonyOptions(raw) as PublicKeyCredentialCreationOptionsJSON;
}

function parseAuthenticationOptions(raw: unknown): PublicKeyCredentialRequestOptionsJSON {
  return checkedCeremonyOptions(raw) as PublicKeyCredentialRequestOptionsJSON;
}

/** Student claims reveal a crown code; guardian portal claims a login email. */
export type WelcomeCredentials =
  | { kind: 'student'; crownCode: string; pin: string }
  | { kind: 'guardian'; loginEmail: string; pin: string };

export type ClaimedWelcome = { session: AuthSession; credentials: WelcomeCredentials };

export type ClaimResult = { ok: true; claimed: ClaimedWelcome } | { ok: false; message: string };

function parseClaimResponse(raw: unknown): ClaimedWelcome {
  const session = parseLoginResponse(raw);
  const record = raw as { credentials?: unknown };
  const credentials = record.credentials as Record<string, unknown> | null | undefined;
  if (
    typeof credentials !== 'object' ||
    credentials === null ||
    typeof credentials.pin !== 'string' ||
    !/^\d{4,8}$/.test(credentials.pin)
  ) {
    throw new Error('claim credentials are malformed');
  }
  if (session.subject.type === 'guardian') {
    if (typeof credentials.loginEmail !== 'string' || credentials.loginEmail === '') {
      throw new Error('claim credentials are malformed');
    }
    return {
      session,
      credentials: { kind: 'guardian', loginEmail: credentials.loginEmail, pin: credentials.pin },
    };
  }
  if (typeof credentials.crownCode !== 'string' || credentials.crownCode === '') {
    throw new Error('claim credentials are malformed');
  }
  return {
    session,
    credentials: { kind: 'student', crownCode: credentials.crownCode, pin: credentials.pin },
  };
}

/**
 * First login through an emailed magic link (OD-19). Deliberately does NOT
 * install the session: the welcome screen shows the one-time credentials
 * first, then calls installSession when she taps continue.
 */
export async function claimMagicLink(linkToken: string): Promise<ClaimResult> {
  let turnstileToken: string;
  try {
    turnstileToken = await getTurnstileToken();
  } catch {
    return { ok: false, message: MESSAGES.turnstile ?? '' };
  }

  const result = await callEdgeFunction('magic-link-claim', {
    method: 'POST',
    body: { token: linkToken, turnstileToken },
    parse: parseClaimResponse,
  });
  if (!result.ok) {
    return { ok: false, message: failureMessage(result.failure) };
  }
  logger.info('auth.magic_link_claimed', { subjectId: result.data.session.subject.id });
  return { ok: true, claimed: result.data };
}

/** Activates a session minted by a claim (the welcome screen's continue). */
export function installSession(next: AuthSession): void {
  session = next;
  notify();
}

/** Usernameless passkey sign-in (Face ID / Touch ID). */
export async function loginWithPasskey(): Promise<LoginResult> {
  if (!passkeysSupported()) {
    return { ok: false, message: MESSAGES.passkey_unsupported ?? '' };
  }

  const optionsResult = await callEdgeFunction('auth-webauthn-login/options', {
    method: 'POST',
    parse: parseAuthenticationOptions,
  });
  if (!optionsResult.ok) {
    return { ok: false, message: failureMessage(optionsResult.failure) };
  }

  let ceremony;
  try {
    ceremony = await performAuthentication(optionsResult.data);
  } catch {
    // The user dismissed the platform prompt (or no passkey exists here).
    return { ok: false, message: MESSAGES.passkey_cancelled ?? '' };
  }

  const result = await callEdgeFunction('auth-webauthn-login/verify', {
    method: 'POST',
    body: { challenge: ceremony.challenge, response: ceremony.response },
    parse: parseLoginResponse,
  });
  if (!result.ok) {
    return { ok: false, message: failureMessage(result.failure) };
  }

  session = result.data;
  logger.info('auth.passkey_login_succeeded', { subjectId: result.data.subject.id });
  notify();
  return { ok: true };
}

/** Enrolls this device's passkey for the signed-in user. */
export async function registerPasskey(): Promise<LoginResult> {
  const current = session;
  if (current === null) {
    return { ok: false, message: MESSAGES.server ?? '' };
  }
  if (!passkeysSupported()) {
    return { ok: false, message: MESSAGES.passkey_unsupported ?? '' };
  }

  const optionsResult = await callEdgeFunction('auth-webauthn-register/options', {
    method: 'POST',
    sessionToken: current.token,
    parse: parseRegistrationOptions,
  });
  if (!optionsResult.ok) {
    return { ok: false, message: failureMessage(optionsResult.failure) };
  }

  let ceremony;
  try {
    ceremony = await performRegistration(optionsResult.data);
  } catch {
    return { ok: false, message: MESSAGES.passkey_cancelled ?? '' };
  }

  const result = await callEdgeFunction('auth-webauthn-register/verify', {
    method: 'POST',
    sessionToken: current.token,
    body: { challenge: ceremony.challenge, response: ceremony.response },
    parse: () => null,
  });
  if (!result.ok) {
    return { ok: false, message: failureMessage(result.failure) };
  }

  session = { ...current, webauthnRegistered: true };
  logger.info('auth.passkey_registered', { subjectId: current.subject.id });
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
