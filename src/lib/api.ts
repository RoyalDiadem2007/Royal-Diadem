/**
 * Edge Function client. All server communication flows through here so error
 * handling is uniform and nothing internal ever reaches the UI: callers get a
 * typed result, never a raw response or server detail (CLAUDE.md §12).
 */
import { publishableKey, supabaseUrl } from '@/config/env.config';
import { logger } from '@/lib/logger';

export type ApiFailure =
  | { kind: 'rate_limited'; retryAfterSeconds: number }
  | { kind: 'denied'; code: string }
  | { kind: 'network' }
  | { kind: 'server' };

export type ApiResult<T> = { ok: true; data: T } | { ok: false; failure: ApiFailure };

type CallOptions<T> = {
  method: 'GET' | 'POST';
  /** JSON-serialized as-is. */
  body?: unknown;
  sessionToken?: string;
  /** Validates/narrows the response body; throw to reject an unexpected shape. */
  parse: (raw: unknown) => T;
};

function errorCodeFrom(raw: unknown): string {
  if (typeof raw === 'object' && raw !== null && 'error' in raw && typeof raw.error === 'string') {
    return raw.error;
  }
  return 'unknown';
}

export async function callEdgeFunction<T>(
  name: string,
  options: CallOptions<T>,
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {
    apikey: publishableKey(),
    'Content-Type': 'application/json',
  };
  if (options.sessionToken !== undefined) {
    headers.Authorization = `Bearer ${options.sessionToken}`;
  }

  let response: Response;
  try {
    response = await fetch(`${supabaseUrl()}/functions/v1/${name}`, {
      method: options.method,
      headers,
      body: options.body === undefined ? null : JSON.stringify(options.body),
    });
  } catch {
    // Recovery = report a retryable network failure; the UI tells the user.
    logger.warn('api.network_error', { fn: name });
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

  // Statuses whose body carries an actionable machine code: auth denials
  // (401/403) and refusals with a specific missing precondition (409 e.g.
  // no_guardian_email, 503 email_not_configured). Everything else stays a
  // generic server failure.
  if ([401, 403, 409, 503].includes(response.status)) {
    let raw: unknown = null;
    try {
      raw = await response.json();
    } catch {
      // Body is optional on a deny; the status code alone is meaningful.
    }
    return { ok: false, failure: { kind: 'denied', code: errorCodeFrom(raw) } };
  }

  if (!response.ok) {
    logger.error('api.server_error', { fn: name, httpStatus: response.status });
    return { ok: false, failure: { kind: 'server' } };
  }

  if (response.status === 204) {
    return { ok: true, data: options.parse(null) };
  }

  try {
    const raw: unknown = await response.json();
    return { ok: true, data: options.parse(raw) };
  } catch {
    // A 2xx with an unparseable/unexpected body is a server contract break.
    logger.error('api.bad_response_shape', { fn: name });
    return { ok: false, failure: { kind: 'server' } };
  }
}
