/**
 * Client for the admin-calendar Edge Function (Phase 9): event CRUD for the
 * admin panel. Recurrence on the wire is `repeatsWeekly` + optional
 * `repeatUntil` — the weekly subset is the whole recurrence model.
 */
import { callEdgeFunction, type ApiResult } from '@/lib/api';

export type AdminCalendarEvent = {
  id: string;
  title: string;
  description: string | null;
  eventDate: string;
  /** HH:MM, 24h. */
  eventTime: string | null;
  endTime: string | null;
  repeatsWeekly: boolean;
  recurrenceRule: string | null;
};

export type EventInput = {
  title: string;
  description: string | null;
  eventDate: string;
  eventTime: string | null;
  endTime: string | null;
  repeatsWeekly: boolean;
  repeatUntil: string | null;
};

export type EventPage = {
  events: AdminCalendarEvent[];
  page: number;
  pageSize: number;
  total: number;
};

function asRecord(raw: unknown, what: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${what} is not an object`);
  }
  return raw as Record<string, unknown>;
}

function parseEvent(raw: unknown): AdminCalendarEvent {
  const r = asRecord(raw, 'event');
  if (
    typeof r.id !== 'string' ||
    typeof r.title !== 'string' ||
    (r.description !== null && typeof r.description !== 'string') ||
    typeof r.eventDate !== 'string' ||
    (r.eventTime !== null && typeof r.eventTime !== 'string') ||
    (r.endTime !== null && typeof r.endTime !== 'string') ||
    typeof r.repeatsWeekly !== 'boolean' ||
    (r.recurrenceRule !== null && typeof r.recurrenceRule !== 'string')
  ) {
    throw new Error('event is malformed');
  }
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    eventDate: r.eventDate,
    eventTime: r.eventTime,
    endTime: r.endTime,
    repeatsWeekly: r.repeatsWeekly,
    recurrenceRule: r.recurrenceRule,
  };
}

function parsePage(raw: unknown): EventPage {
  const r = asRecord(raw, 'events response');
  if (
    !Array.isArray(r.events) ||
    typeof r.page !== 'number' ||
    typeof r.pageSize !== 'number' ||
    typeof r.total !== 'number'
  ) {
    throw new Error('events response is malformed');
  }
  return {
    events: r.events.map(parseEvent),
    page: r.page,
    pageSize: r.pageSize,
    total: r.total,
  };
}

export async function listEvents(
  sessionToken: string,
  page: number,
): Promise<ApiResult<EventPage>> {
  return callEdgeFunction(`admin-calendar?page=${String(page)}`, {
    method: 'GET',
    sessionToken,
    parse: parsePage,
  });
}

export async function createEvent(
  sessionToken: string,
  input: EventInput,
): Promise<ApiResult<AdminCalendarEvent>> {
  return callEdgeFunction('admin-calendar/create', {
    method: 'POST',
    sessionToken,
    body: input,
    parse: (raw) => parseEvent(asRecord(raw, 'create response').event),
  });
}

export async function updateEvent(
  sessionToken: string,
  eventId: string,
  input: EventInput,
): Promise<ApiResult<AdminCalendarEvent>> {
  return callEdgeFunction('admin-calendar/update', {
    method: 'POST',
    sessionToken,
    body: { eventId, ...input },
    parse: (raw) => parseEvent(asRecord(raw, 'update response').event),
  });
}

export async function deleteEvent(sessionToken: string, eventId: string): Promise<ApiResult<null>> {
  return callEdgeFunction('admin-calendar/delete', {
    method: 'POST',
    sessionToken,
    body: { eventId },
    parse: () => null,
  });
}
