/**
 * Anon Data API reads (the publishable key = the anon role). Only genuinely
 * public, admin-approved program content crosses this path — posted daily
 * messages, visible calendar events, announcements — each behind its own
 * RLS policy (docs/SUPABASE_RULES.md §3). Everything else goes through Edge
 * Functions. Same typed-result contract as the Edge client (api.ts).
 */
import { publishableKey, supabaseUrl } from '@/config/env.config';
import type { ApiResult } from '@/lib/api';
import { logger } from '@/lib/logger';

type ReadOptions<T> = {
  /** Validates/narrows the response body; throw to reject an unexpected shape. */
  parse: (raw: unknown) => T;
};

export async function readDataApi<T>(
  pathWithQuery: string,
  options: ReadOptions<T>,
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(`${supabaseUrl()}/rest/v1/${pathWithQuery}`, {
      headers: {
        apikey: publishableKey(),
        Authorization: `Bearer ${publishableKey()}`,
      },
    });
  } catch {
    logger.warn('dataApi.network_error');
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
    logger.error('dataApi.server_error', { httpStatus: response.status });
    return { ok: false, failure: { kind: 'server' } };
  }

  try {
    const raw: unknown = await response.json();
    return { ok: true, data: options.parse(raw) };
  } catch {
    logger.error('dataApi.bad_response_shape', {});
    return { ok: false, failure: { kind: 'server' } };
  }
}
