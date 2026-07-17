/**
 * Crown Check domain rules (Phase 5, Spec §6.2/§7): the program-local day
 * boundary and the pattern-based AI flag. Pattern matching only — no model
 * call, no interpretation (Spec §7 "Threshold-based notification, not AI
 * interpretation").
 */

/**
 * White-label rule (§4.5): the timezone is deployment configuration.
 * 'America/Chicago' is this deployment's default (Houston program); other
 * tenants set PROGRAM_TIMEZONE as a function secret. The crown_checks
 * check_date column default mirrors this same default.
 */
export function programTimezone(): string {
  const configured = Deno.env.get('PROGRAM_TIMEZONE')?.trim();
  return configured !== undefined && configured !== '' ? configured : 'America/Chicago';
}

/** Calendar date (YYYY-MM-DD) of `now` in the program's timezone. */
export function programToday(now: Date): string {
  // en-CA formats as YYYY-MM-DD directly.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: programTimezone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Flag rule (decided 2026-07-17): the student's last CONSECUTIVE_LOW_TO_FLAG
 * submitted checks all scoring ≤ LOW_SCORE_MAX raise one high-severity flag
 * (OD-3: high severity surfaces immediately to super_admins). Tunable
 * constants, not magic numbers.
 */
export const LOW_SCORE_MAX = 2;
export const CONSECUTIVE_LOW_TO_FLAG = 3;
export const CROWN_FLAG_SEVERITY = 'high';

/**
 * `recentScores` is the student's check scores newest-first. True when enough
 * checks exist and the newest CONSECUTIVE_LOW_TO_FLAG are all low.
 */
export function isConsecutiveLow(recentScores: readonly number[]): boolean {
  if (recentScores.length < CONSECUTIVE_LOW_TO_FLAG) {
    return false;
  }
  return recentScores.slice(0, CONSECUTIVE_LOW_TO_FLAG).every((score) => score <= LOW_SCORE_MAX);
}

/** Human-readable reason stored on the flagged check (ids/threshold only). */
export function consecutiveLowReason(): string {
  return `${String(CONSECUTIVE_LOW_TO_FLAG)} consecutive check-ins at or below ${String(LOW_SCORE_MAX)}`;
}
