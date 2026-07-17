/**
 * Opaque-token sessions (OD-1): raw 256-bit token to the client (in-memory
 * only), SHA-256 digest in public.sessions. Every request re-validates against
 * the table — instantly revocable, fully auditable, no self-validating JWTs.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { generateOpaqueToken, sha256Hex } from './hash.ts';
import { serverLog } from './logger.ts';

export type SubjectType = 'student' | 'admin' | 'guardian';

export type SessionSubject = {
  sessionId: string;
  subjectType: SubjectType;
  subjectId: string;
  expiresAt: string;
};

type SessionPolicy = { idleSeconds: number; absoluteSeconds: number };

// Students: 12h idle / 24h absolute. Admins handle regulated data, so shorter:
// 2h idle / 12h absolute, with re-auth for sensitive actions (CLAUDE.md §17.2).
// Guardians view a minor's data through consent windows — shortest of all.
const POLICIES: Readonly<Record<SubjectType, SessionPolicy>> = {
  student: { idleSeconds: 12 * 3600, absoluteSeconds: 24 * 3600 },
  admin: { idleSeconds: 2 * 3600, absoluteSeconds: 12 * 3600 },
  guardian: { idleSeconds: 1 * 3600, absoluteSeconds: 8 * 3600 },
};

export type MintedSession = { token: string; expiresAt: string };

export async function mintSession(
  db: SupabaseClient,
  subjectType: SubjectType,
  subjectId: string,
  ip: string | null,
  userAgent: string | null,
): Promise<MintedSession | null> {
  const token = generateOpaqueToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + POLICIES[subjectType].absoluteSeconds * 1000);
  const { error } = await db.from('sessions').insert({
    token_hash: tokenHash,
    subject_type: subjectType,
    subject_id: subjectId,
    expires_at: expiresAt.toISOString(),
    ip_address: ip,
    user_agent: userAgent,
  });
  if (error !== null) {
    serverLog.error('session.mint_failed', {});
    return null;
  }
  return { token, expiresAt: expiresAt.toISOString() };
}

/**
 * Validates a raw token: exists, not revoked, inside absolute expiry, inside
 * idle window. Valid → slides last_seen_at and returns the subject.
 */
export async function verifySession(
  db: SupabaseClient,
  rawToken: string,
): Promise<SessionSubject | null> {
  const tokenHash = await sha256Hex(rawToken);
  const { data, error } = await db
    .from('sessions')
    .select('id, subject_type, subject_id, last_seen_at, expires_at, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (error !== null) {
    serverLog.error('session.lookup_failed', {});
    return null; // fail closed
  }
  if (data === null) {
    return null;
  }

  const subjectType: unknown = data.subject_type;
  if (subjectType !== 'student' && subjectType !== 'admin' && subjectType !== 'guardian') {
    return null;
  }
  const now = Date.now();
  const revoked = data.revoked_at !== null;
  const pastAbsolute = new Date(String(data.expires_at)).getTime() <= now;
  const idleMs = POLICIES[subjectType].idleSeconds * 1000;
  const pastIdle = new Date(String(data.last_seen_at)).getTime() + idleMs <= now;
  if (revoked || pastAbsolute || pastIdle) {
    return null;
  }

  const { error: touchError } = await db
    .from('sessions')
    .update({ last_seen_at: new Date(now).toISOString() })
    .eq('id', String(data.id));
  if (touchError !== null) {
    serverLog.warn('session.touch_failed', {});
  }

  return {
    sessionId: String(data.id),
    subjectType,
    subjectId: String(data.subject_id),
    expiresAt: String(data.expires_at),
  };
}

export async function revokeSession(db: SupabaseClient, rawToken: string): Promise<boolean> {
  const tokenHash = await sha256Hex(rawToken);
  const { error } = await db
    .from('sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('token_hash', tokenHash)
    .is('revoked_at', null);
  if (error !== null) {
    serverLog.error('session.revoke_failed', {});
    return false;
  }
  return true;
}
