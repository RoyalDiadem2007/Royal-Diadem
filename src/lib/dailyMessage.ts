/**
 * Daily Crown Message read (Spec §6.5 step 7, Phase 8). A direct Data API
 * read: RLS exposes only status = posted rows to anon (core_schema
 * migration), so no Edge Function sits in front. Everything student-facing
 * upstream of "posted" is admin-approved (OD-18).
 */
import type { ApiResult } from '@/lib/api';
import { readDataApi } from '@/lib/dataApi';

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
  return readDataApi(`encouragement_messages?${query}`, { parse: parseRows });
}
