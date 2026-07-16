/**
 * Cloudflare Turnstile server-side verification (docs/SUPABASE_RULES.md §6).
 * Fail closed: missing secret, network trouble, or success !== true all deny.
 */
import { serverLog } from './logger.ts';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const VERIFY_TIMEOUT_MS = 10_000;

export type TurnstileResult = { ok: true } | { ok: false; reason: string };

export async function verifyTurnstile(
  token: string,
  remoteIp: string | null,
): Promise<TurnstileResult> {
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY');
  if (secret === undefined || secret === '') {
    serverLog.error('turnstile.unconfigured', {});
    return { ok: false, reason: 'unconfigured' };
  }

  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  // Idempotency key so a network timeout + retry is not falsely rejected as a
  // duplicate token (single-use tokens; important on flaky phone connections).
  form.append('idempotency_key', crypto.randomUUID());
  if (remoteIp !== null) {
    form.append('remoteip', remoteIp);
  }

  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!res.ok) {
      serverLog.warn('turnstile.http_error', { status: res.status });
      return { ok: false, reason: 'verify_unavailable' };
    }
    const outcome: unknown = await res.json();
    const success =
      typeof outcome === 'object' &&
      outcome !== null &&
      'success' in outcome &&
      outcome.success === true;
    return success ? { ok: true } : { ok: false, reason: 'challenge_failed' };
  } catch {
    // Recovery = deny (fail closed) with an operational trace for diagnosis.
    serverLog.error('turnstile.verify_error', {});
    return { ok: false, reason: 'verify_unavailable' };
  }
}
