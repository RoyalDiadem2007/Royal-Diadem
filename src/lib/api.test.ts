import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callEdgeFunction } from '@/lib/api';

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

describe('callEdgeFunction', () => {
  it('calls the function URL with apikey and parses a 2xx body', async () => {
    const fetchMock = stubFetch(
      new Response(JSON.stringify({ value: 7 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await callEdgeFunction('demo', {
      method: 'POST',
      body: { a: 1 },
      parse: (raw) => {
        if (typeof raw !== 'object' || raw === null || !('value' in raw)) {
          throw new Error('bad shape');
        }
        return raw.value;
      },
    });

    expect(result).toEqual({ ok: true, data: 7 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.supabase.co/functions/v1/demo');
    const headers = init.headers as Record<string, string>;
    expect(headers.apikey).toBe('sb_publishable_test');
  });

  it('maps 429 to rate_limited with the Retry-After value', async () => {
    stubFetch(new Response(null, { status: 429, headers: { 'Retry-After': '300' } }));
    const result = await callEdgeFunction('demo', { method: 'POST', parse: () => null });
    expect(result).toEqual({
      ok: false,
      failure: { kind: 'rate_limited', retryAfterSeconds: 300 },
    });
  });

  it('maps 401/403 to denied with the server error code', async () => {
    stubFetch(
      new Response(JSON.stringify({ error: 'consent_pending' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const result = await callEdgeFunction('demo', { method: 'POST', parse: () => null });
    expect(result).toEqual({ ok: false, failure: { kind: 'denied', code: 'consent_pending' } });
  });

  it('maps a thrown fetch (offline) to a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('failed to fetch'))),
    );
    const result = await callEdgeFunction('demo', { method: 'GET', parse: () => null });
    expect(result).toEqual({ ok: false, failure: { kind: 'network' } });
  });

  it('maps 5xx to a generic server failure without leaking detail', async () => {
    stubFetch(new Response('stack trace!!!', { status: 500 }));
    const result = await callEdgeFunction('demo', { method: 'POST', parse: () => null });
    expect(result).toEqual({ ok: false, failure: { kind: 'server' } });
  });

  it('treats a 2xx body that fails parsing as a server contract break', async () => {
    stubFetch(
      new Response(JSON.stringify({ unexpected: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const result = await callEdgeFunction('demo', {
      method: 'GET',
      parse: () => {
        throw new Error('unexpected shape');
      },
    });
    expect(result).toEqual({ ok: false, failure: { kind: 'server' } });
  });
});
