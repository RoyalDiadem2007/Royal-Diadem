/**
 * HTTP plumbing for Edge Functions: CORS (real origins only — rules §8) and
 * safe responses. Client-facing errors are generic codes; detail stays in
 * server logs (CLAUDE.md §6/§12).
 */

const DEFAULT_DEV_ORIGIN = 'http://localhost:5173';

function allowedOrigins(): readonly string[] {
  const raw = Deno.env.get('ALLOWED_ORIGINS');
  if (raw === undefined || raw.trim() === '') {
    // Production MUST set ALLOWED_ORIGINS (the Vercel domain); the fallback
    // only ever matches local development.
    return [DEFAULT_DEV_ORIGIN];
  }
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o !== '');
}

/**
 * The app's canonical public origin — where emailed links point. First entry
 * of ALLOWED_ORIGINS (production sets it; the fallback is local dev only).
 */
export function appOrigin(): string {
  return allowedOrigins()[0] ?? DEFAULT_DEV_ORIGIN;
}

export function corsHeaders(req: Request): Headers {
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  });
  const origin = req.headers.get('origin');
  if (origin !== null && allowedOrigins().includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
  }
  return headers;
}

export function handlePreflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  return null;
}

export function jsonResponse(
  req: Request,
  status: number,
  body: Readonly<Record<string, unknown>>,
  extraHeaders: Readonly<Record<string, string>> = {},
): Response {
  const headers = corsHeaders(req);
  headers.set('Content-Type', 'application/json');
  for (const [k, v] of Object.entries(extraHeaders)) {
    headers.set(k, v);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

/** Generic client-safe error: a stable machine code, no internals. */
export function errorResponse(
  req: Request,
  status: number,
  code: string,
  extraHeaders: Readonly<Record<string, string>> = {},
): Response {
  return jsonResponse(req, status, { error: code }, extraHeaders);
}

/** Extracts the caller IP (first x-forwarded-for hop) or null. */
export function clientIp(req: Request): string | null {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded === null) {
    return null;
  }
  const first = forwarded.split(',')[0]?.trim() ?? '';
  return first === '' ? null : first;
}

/** Extracts a Bearer token from the Authorization header, or null. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get('authorization');
  if (header === null || !header.startsWith('Bearer ')) {
    return null;
  }
  const token = header.slice('Bearer '.length).trim();
  return token === '' ? null : token;
}
