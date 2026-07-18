import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  expandOccurrences,
  fetchVisibleEvents,
  parseWeeklyRule,
  upcomingOccurrences,
  type CalendarEvent,
} from '@/lib/calendar';

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'evt-1',
    title: 'Program night',
    description: null,
    eventDate: '2026-07-20',
    eventTime: null,
    endTime: null,
    isRecurring: false,
    recurrenceRule: null,
    ...overrides,
  };
}

describe('parseWeeklyRule', () => {
  it('parses the open-ended weekly rule', () => {
    expect(parseWeeklyRule('FREQ=WEEKLY')).toEqual({ until: null });
  });

  it('parses the bounded weekly rule', () => {
    expect(parseWeeklyRule('FREQ=WEEKLY;UNTIL=20260831')).toEqual({ until: '2026-08-31' });
  });

  it('rejects anything outside the supported subset', () => {
    expect(parseWeeklyRule('FREQ=MONTHLY')).toBeUndefined();
    expect(parseWeeklyRule('FREQ=WEEKLY;BYDAY=MO')).toBeUndefined();
    expect(parseWeeklyRule('')).toBeUndefined();
  });
});

describe('expandOccurrences', () => {
  it('keeps a one-off event only when it falls inside the window', () => {
    const e = event({ eventDate: '2026-07-25' });
    expect(expandOccurrences(e, '2026-07-20', 60)).toEqual(['2026-07-25']);
    expect(expandOccurrences(e, '2026-07-26', 60)).toEqual([]);
    // The window end is exclusive.
    expect(expandOccurrences(e, '2026-07-20', 5)).toEqual([]);
  });

  it('expands a weekly series started long ago onto the coming weeks', () => {
    const e = event({
      eventDate: '2026-01-07', // a Wednesday months back
      isRecurring: true,
      recurrenceRule: 'FREQ=WEEKLY',
    });
    // Wednesdays inside [2026-07-20, 2026-08-04): Jul 22 and Jul 29.
    expect(expandOccurrences(e, '2026-07-20', 15)).toEqual(['2026-07-22', '2026-07-29']);
  });

  it('stops a bounded series at its UNTIL date', () => {
    const e = event({
      eventDate: '2026-07-21',
      isRecurring: true,
      recurrenceRule: 'FREQ=WEEKLY;UNTIL=20260728',
    });
    expect(expandOccurrences(e, '2026-07-20', 60)).toEqual(['2026-07-21', '2026-07-28']);
  });

  it('treats an unrecognized rule as a one-off on the base date', () => {
    const e = event({
      eventDate: '2026-07-25',
      isRecurring: true,
      recurrenceRule: 'FREQ=MONTHLY',
    });
    expect(expandOccurrences(e, '2026-07-20', 60)).toEqual(['2026-07-25']);
  });

  it('includes a weekly occurrence landing exactly on the from date', () => {
    const e = event({
      eventDate: '2026-07-06',
      isRecurring: true,
      recurrenceRule: 'FREQ=WEEKLY',
    });
    expect(expandOccurrences(e, '2026-07-20', 8)).toEqual(['2026-07-20', '2026-07-27']);
  });
});

describe('upcomingOccurrences', () => {
  it('sorts by date, then start time with all-day entries first, and limits', () => {
    const events = [
      event({ id: 'later', eventDate: '2026-07-22', eventTime: '18:00' }),
      event({ id: 'allday', eventDate: '2026-07-21' }),
      event({ id: 'morning', eventDate: '2026-07-21', eventTime: '09:00' }),
      event({ id: 'evening', eventDate: '2026-07-21', eventTime: '17:30' }),
    ];
    const result = upcomingOccurrences(events, '2026-07-20', 30, 3);
    expect(result.map((o) => o.event.id)).toEqual(['allday', 'morning', 'evening']);
  });

  it('interleaves weekly repeats with one-offs in date order', () => {
    const events = [
      event({
        id: 'weekly',
        eventDate: '2026-07-07',
        isRecurring: true,
        recurrenceRule: 'FREQ=WEEKLY',
      }),
      event({ id: 'oneoff', eventDate: '2026-07-24' }),
    ];
    const result = upcomingOccurrences(events, '2026-07-20', 14, 10);
    expect(result.map((o) => `${o.event.id}:${o.date}`)).toEqual([
      'weekly:2026-07-21',
      'oneoff:2026-07-24',
      'weekly:2026-07-28',
    ]);
  });
});

describe('fetchVisibleEvents', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('asks for future events plus live recurring series, as anon', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            {
              id: 'evt-1',
              title: 'Bible study',
              description: 'Bring your journal',
              event_date: '2026-07-21',
              event_time: '18:00:00',
              end_time: '19:30:00',
              is_recurring: true,
              recurrence_rule: 'FREQ=WEEKLY',
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchVisibleEvents('2026-07-20');

    expect(result).toEqual({
      ok: true,
      data: [
        {
          id: 'evt-1',
          title: 'Bible study',
          description: 'Bring your journal',
          eventDate: '2026-07-21',
          eventTime: '18:00',
          endTime: '19:30',
          isRecurring: true,
          recurrenceRule: 'FREQ=WEEKLY',
        },
      ],
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/rest/v1/calendar_events?');
    expect(url).toContain(
      'or=(event_date.gte.2026-07-20,and(is_recurring.eq.true,recurrence_rule.not.is.null))',
    );
    const headers = init.headers as Record<string, string>;
    expect(headers.apikey).toBe('sb_publishable_test');
  });

  it('rejects a malformed row as a server failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify([{ id: 42 }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    );
    expect(await fetchVisibleEvents('2026-07-20')).toEqual({
      ok: false,
      failure: { kind: 'server' },
    });
  });
});
