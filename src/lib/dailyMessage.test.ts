import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchDailyMessage, localDateIso } from '@/lib/dailyMessage';

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetch(response: Response): ReturnType<typeof vi.fn> {
  const fn = vi.fn(() => Promise.resolve(response));
  vi.stubGlobal('fetch', fn);
  return fn;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('localDateIso', () => {
  it('formats the local calendar date, not the UTC one', () => {
    // 23:30 local on July 18 stays July 18 regardless of the runner's zone.
    expect(localDateIso(new Date(2026, 6, 18, 23, 30))).toBe('2026-07-18');
    expect(localDateIso(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01');
  });
});

describe('fetchDailyMessage', () => {
  it('queries only posted rows for the given date with the publishable key', async () => {
    const fetchMock = stubFetch(
      jsonResponse([
        { message_text: 'You are crowned for this day.', scheduled_date: '2026-07-18' },
      ]),
    );

    const result = await fetchDailyMessage('2026-07-18');

    expect(result).toEqual({
      ok: true,
      data: { text: 'You are crowned for this day.', scheduledDate: '2026-07-18' },
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://example.supabase.co/rest/v1/encouragement_messages' +
        '?select=message_text,scheduled_date&status=eq.posted&scheduled_date=eq.2026-07-18' +
        '&order=posted_at.desc&limit=1',
    );
    const headers = init.headers as Record<string, string>;
    expect(headers.apikey).toBe('sb_publishable_test');
    expect(headers.Authorization).toBe('Bearer sb_publishable_test');
  });

  it('returns null data when no message is posted for the date', async () => {
    stubFetch(jsonResponse([]));
    expect(await fetchDailyMessage('2026-07-18')).toEqual({ ok: true, data: null });
  });

  it('rejects a malformed row as a server failure', async () => {
    stubFetch(jsonResponse([{ message_text: 42, scheduled_date: '2026-07-18' }]));
    expect(await fetchDailyMessage('2026-07-18')).toEqual({
      ok: false,
      failure: { kind: 'server' },
    });
  });

  it('rejects a non-array body as a server failure', async () => {
    stubFetch(jsonResponse({ message: 'not-postgrest' }));
    expect(await fetchDailyMessage('2026-07-18')).toEqual({
      ok: false,
      failure: { kind: 'server' },
    });
  });

  it('maps a thrown fetch (offline) to a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    expect(await fetchDailyMessage('2026-07-18')).toEqual({
      ok: false,
      failure: { kind: 'network' },
    });
  });

  it('maps a 5xx to a server failure', async () => {
    stubFetch(new Response(null, { status: 500 }));
    expect(await fetchDailyMessage('2026-07-18')).toEqual({
      ok: false,
      failure: { kind: 'server' },
    });
  });

  it('maps 429 to rate_limited with the Retry-After value', async () => {
    stubFetch(new Response(null, { status: 429, headers: { 'Retry-After': '120' } }));
    expect(await fetchDailyMessage('2026-07-18')).toEqual({
      ok: false,
      failure: { kind: 'rate_limited', retryAfterSeconds: 120 },
    });
  });
});
