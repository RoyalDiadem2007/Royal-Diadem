/**
 * Student calendar read (Spec §6.6, Phase 9): visible events straight from
 * the Data API (anon RLS policy: visibility = 'all' only), expanded into an
 * upcoming list. Recurrence is the app's documented weekly subset —
 * FREQ=WEEKLY with optional UNTIL — the only rule admin-calendar writes; an
 * unrecognized rule falls back to the base date alone rather than guessing.
 */
import type { ApiResult } from '@/lib/api';
import { readDataApi } from '@/lib/dataApi';

export type CalendarEvent = {
  id: string;
  title: string;
  description: string | null;
  eventDate: string;
  /** HH:MM, 24h. */
  eventTime: string | null;
  endTime: string | null;
  isRecurring: boolean;
  recurrenceRule: string | null;
};

/** One concrete day an event happens on. */
export type EventOccurrence = { event: CalendarEvent; date: string };

const WEEKLY_RULE = /^FREQ=WEEKLY(?:;UNTIL=(\d{8}))?$/;

/**
 * Parses the weekly-subset rule. Returns the series end date (or null for
 * open-ended), or undefined when the rule isn't the supported subset.
 */
export function parseWeeklyRule(rule: string): { until: string | null } | undefined {
  const match = WEEKLY_RULE.exec(rule);
  if (match === null) {
    return undefined;
  }
  const raw = match[1];
  if (raw === undefined) {
    return { until: null };
  }
  return { until: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` };
}

function shiftDays(isoDate: string, days: number): string {
  const base = new Date(`${isoDate}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/**
 * Concrete dates for one event within [fromIso, fromIso + windowDays).
 * Non-recurring: the base date if it falls inside the window. Weekly: every
 * 7th day from the base date inside the window, capped by UNTIL.
 */
export function expandOccurrences(
  event: CalendarEvent,
  fromIso: string,
  windowDays: number,
): string[] {
  const windowEnd = shiftDays(fromIso, windowDays);
  const rule =
    event.isRecurring && event.recurrenceRule !== null
      ? parseWeeklyRule(event.recurrenceRule)
      : undefined;

  if (rule === undefined) {
    return event.eventDate >= fromIso && event.eventDate < windowEnd ? [event.eventDate] : [];
  }

  const dates: string[] = [];
  let cursor = event.eventDate;
  if (cursor < fromIso) {
    // Jump the series forward in whole weeks instead of walking one by one.
    const gapDays = Math.floor(
      (Date.parse(`${fromIso}T00:00:00Z`) - Date.parse(`${cursor}T00:00:00Z`)) / 86_400_000,
    );
    cursor = shiftDays(cursor, Math.floor(gapDays / 7) * 7);
    while (cursor < fromIso) {
      cursor = shiftDays(cursor, 7);
    }
  }
  while (cursor < windowEnd && (rule.until === null || cursor <= rule.until)) {
    dates.push(cursor);
    cursor = shiftDays(cursor, 7);
  }
  return dates;
}

/**
 * The next `limit` occurrences across all events, soonest first; same-day
 * events order by start time (all-day entries first).
 */
export function upcomingOccurrences(
  events: readonly CalendarEvent[],
  fromIso: string,
  windowDays: number,
  limit: number,
): EventOccurrence[] {
  const occurrences: EventOccurrence[] = [];
  for (const event of events) {
    for (const date of expandOccurrences(event, fromIso, windowDays)) {
      occurrences.push({ event, date });
    }
  }
  occurrences.sort((a, b) => {
    if (a.date !== b.date) {
      return a.date < b.date ? -1 : 1;
    }
    const aTime = a.event.eventTime ?? '';
    const bTime = b.event.eventTime ?? '';
    return aTime < bTime ? -1 : aTime > bTime ? 1 : 0;
  });
  return occurrences.slice(0, limit);
}

function parseEvent(raw: unknown): CalendarEvent {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('calendar event is not an object');
  }
  const r = raw as Record<string, unknown>;
  if (
    typeof r.id !== 'string' ||
    typeof r.title !== 'string' ||
    (r.description !== null && typeof r.description !== 'string') ||
    typeof r.event_date !== 'string' ||
    (r.event_time !== null && typeof r.event_time !== 'string') ||
    (r.end_time !== null && typeof r.end_time !== 'string') ||
    typeof r.is_recurring !== 'boolean' ||
    (r.recurrence_rule !== null && typeof r.recurrence_rule !== 'string')
  ) {
    throw new Error('calendar event is malformed');
  }
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    eventDate: r.event_date,
    // Postgres `time` serializes HH:MM:SS; the app renders HH:MM.
    eventTime: r.event_time === null ? null : r.event_time.slice(0, 5),
    endTime: r.end_time === null ? null : r.end_time.slice(0, 5),
    isRecurring: r.is_recurring,
    recurrenceRule: r.recurrence_rule,
  };
}

/**
 * Visible events that can still produce an occurrence on/after `fromIso`:
 * future-dated ones plus every recurring series (their base date may be
 * long past while the series is still alive).
 */
export async function fetchVisibleEvents(fromIso: string): Promise<ApiResult<CalendarEvent[]>> {
  const query =
    'select=id,title,description,event_date,event_time,end_time,is_recurring,recurrence_rule' +
    `&or=(event_date.gte.${fromIso},and(is_recurring.eq.true,recurrence_rule.not.is.null))` +
    '&order=event_date.asc&limit=200';
  return readDataApi(`calendar_events?${query}`, {
    parse: (raw) => {
      if (!Array.isArray(raw)) {
        throw new Error('calendar response is not an array');
      }
      return raw.map(parseEvent);
    },
  });
}
