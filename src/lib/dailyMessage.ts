/**
 * Daily Crown Message read (Spec §6.5 step 7, Phase 8). The one table the
 * client reads straight from the Data API: RLS exposes only status = posted
 * rows to anon (core_schema migration), so no Edge Function sits in front.
 * Everything student-facing upstream of "posted" is admin-approved (OD-18).
 */
import { publishableKey, supabaseUrl } from '@/config/env.config';
import type { ApiResult } from '@/lib/api';
import { logger } from '@/lib/logger';

export type DailyMessage = { text: string; scheduledDate: string };

/**
 * The device's local calendar date as YYYY-MM-DD (same convention as
 * adminEncouragement.mondayOf: local date parts, UTC math for formatting).
 * The message schedule is date-only, so "today" means the student's today.
 */
export function localDateIso(date: Date): string {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  return utc.toISOString().slice(0, 10);
}

function parseRows(raw: unknown): DailyMessage | null {
  if (!Array.isArray(raw)) {
    throw new Error('daily message response is not an array');
  }
  const first: unknown = raw[0];
  if (first === undefined) {
    return null;
  }
  if (
    typeof first !== 'object' ||
    first === null ||
    !('message_text' in first) ||
    typeof first.message_text !== 'string' ||
    !('scheduled_date' in first) ||
    typeof first.scheduled_date !== 'string'
  ) {
    throw new Error('daily message row is malformed');
  }
  return { text: first.message_text, scheduledDate: first.scheduled_date };
}

/**
 * Fetches the posted message for `todayIso` (YYYY-MM-DD). `null` data means
 * no message is posted for that date — a normal state, not a failure. If two
 * rows ever share a date, the most recently posted one wins.
 */
export async function fetchDailyMessage(todayIso: string): Promise<ApiResult<DailyMessage | null>> {
  const query =
    'select=message_text,scheduled_date' +
    `&status=eq.posted&scheduled_date=eq.${todayIso}` +
    '&order=posted_at.desc&limit=1';

  let response: Response;
  try {
    response = await fetch(`${supabaseUrl()}/rest/v1/encouragement_messages?${query}`, {
      headers: {
        apikey: publishableKey(),
        Authorization: `Bearer ${publishableKey()}`,
      },
    });
  } catch {
    logger.warn('dailyMessage.network_error');
    return { ok: false, failure: { kind: 'network' } };
  }

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('retry-after') ?? '900');
    return {
      ok: false,
      failure: {
        kind: 'rate_limited',
        retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 900,
      },
    };
  }

  if (!response.ok) {
    logger.error('dailyMessage.server_error', { httpStatus: response.status });
    return { ok: false, failure: { kind: 'server' } };
  }

  try {
    const raw: unknown = await response.json();
    return { ok: true, data: parseRows(raw) };
  } catch {
    logger.error('dailyMessage.bad_response_shape');
    return { ok: false, failure: { kind: 'server' } };
  }
}
