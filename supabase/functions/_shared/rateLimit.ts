/**
 * Login rate limiting (CLAUDE.md §10): strict per-identifier lockout plus a
 * wider per-IP net, both counted atomically in Postgres
 * (public.record_auth_attempt). Limiter unavailable → deny (fail closed).
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { serverLog } from './logger.ts';

export type RateLimitOutcome =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number; reason: 'limited' | 'unavailable' };

type Policy = { maxAttempts: number; windowSeconds: number; lockoutSeconds: number };

// 5 failures per identifier per 15 min → 15 min lockout (short PINs are
// brute-forceable; this plus Turnstile is the §10 requirement).
const IDENTIFIER_POLICY: Policy = { maxAttempts: 5, windowSeconds: 900, lockoutSeconds: 900 };
// Wider per-IP net across identifiers (cohort devices may share an IP).
const IP_POLICY: Policy = { maxAttempts: 20, windowSeconds: 900, lockoutSeconds: 900 };

const LIMITER_DOWN_RETRY_SECONDS = 60;

async function recordAttempt(
  db: SupabaseClient,
  key: string,
  policy: Policy,
): Promise<RateLimitOutcome> {
  const { data, error } = await db.rpc('record_auth_attempt', {
    p_key: key,
    p_max_attempts: policy.maxAttempts,
    p_window_seconds: policy.windowSeconds,
    p_lockout_seconds: policy.lockoutSeconds,
  });
  if (error !== null || !Array.isArray(data) || data.length === 0) {
    serverLog.error('rate_limit.unavailable', { limitKeyPrefix: key.split(':')[0] ?? '' });
    return { allowed: false, retryAfterSeconds: LIMITER_DOWN_RETRY_SECONDS, reason: 'unavailable' };
  }
  const row: unknown = data[0];
  if (
    typeof row !== 'object' ||
    row === null ||
    !('allowed' in row) ||
    !('retry_after_seconds' in row)
  ) {
    serverLog.error('rate_limit.bad_shape', {});
    return { allowed: false, retryAfterSeconds: LIMITER_DOWN_RETRY_SECONDS, reason: 'unavailable' };
  }
  if (row.allowed === true) {
    return { allowed: true };
  }
  const retry = typeof row.retry_after_seconds === 'number' ? row.retry_after_seconds : 900;
  return { allowed: false, retryAfterSeconds: retry, reason: 'limited' };
}

/** Records one login attempt against both keys; either limit denies. */
export async function enforceLoginRateLimit(
  db: SupabaseClient,
  identifier: string,
  ip: string | null,
): Promise<RateLimitOutcome> {
  const identifierOutcome = await recordAttempt(
    db,
    `login:id:${identifier.toLowerCase()}`,
    IDENTIFIER_POLICY,
  );
  if (!identifierOutcome.allowed) {
    return identifierOutcome;
  }
  if (ip !== null) {
    return recordAttempt(db, `login:ip:${ip.toLowerCase()}`, IP_POLICY);
  }
  return { allowed: true };
}

// Magic-link claims: tokens are 256-bit and single-use, so the limiter only
// needs to blunt online guessing/scraping, not carry the whole defense.
const CLAIM_IP_POLICY: Policy = { maxAttempts: 10, windowSeconds: 900, lockoutSeconds: 900 };

// Consent-code entry: 6 digits, 10-minute life, single-use — the limiter
// (per guardian account, plus the IP net) makes online guessing hopeless.
const CODE_ENTRY_POLICY: Policy = { maxAttempts: 5, windowSeconds: 600, lockoutSeconds: 900 };

/** Records one consent-code attempt for this guardian account; fail closed. */
export async function enforceCodeEntryRateLimit(
  db: SupabaseClient,
  accountId: string,
): Promise<RateLimitOutcome> {
  return recordAttempt(db, `gcode:acct:${accountId.toLowerCase()}`, CODE_ENTRY_POLICY);
}

// AI generation (OD-18 cost cap): the weekly batch needs ~1 call/week; 10/day
// leaves room for retries and regenerations without runaway spend.
const AI_GENERATION_POLICY: Policy = { maxAttempts: 10, windowSeconds: 86_400, lockoutSeconds: 3_600 };

/** Records one AI generation attempt (global — cost is org-wide); fail closed. */
export async function enforceAiGenerationRateLimit(db: SupabaseClient): Promise<RateLimitOutcome> {
  return recordAttempt(db, 'aigen:global', AI_GENERATION_POLICY);
}

/** Records one magic-link claim attempt for this IP; fail closed. */
export async function enforceClaimRateLimit(
  db: SupabaseClient,
  ip: string | null,
): Promise<RateLimitOutcome> {
  // No IP header at all → treat as the shared "unknown" bucket rather than
  // waving it through: still bounded, still fail closed if the limiter dies.
  return recordAttempt(db, `claim:ip:${(ip ?? 'unknown').toLowerCase()}`, CLAIM_IP_POLICY);
}

/** On successful login: clear the identifier counter (IP counter stays). */
export async function clearIdentifierAttempts(db: SupabaseClient, identifier: string): Promise<void> {
  const { error } = await db.rpc('clear_auth_attempts', {
    p_key: `login:id:${identifier.toLowerCase()}`,
  });
  if (error !== null) {
    // Non-fatal: the window will expire on its own; log for visibility.
    serverLog.warn('rate_limit.clear_failed', {});
  }
}
