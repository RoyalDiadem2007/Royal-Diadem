/**
 * Server-side Supabase client using the SECRET key (bypasses RLS — intended,
 * server-only; docs/SUPABASE_RULES.md §1/§8). Fails loudly at startup if the
 * platform env is missing rather than limping along unauthenticated.
 */
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function resolveSecret(): string {
  // Hosted platform: SUPABASE_SECRET_KEYS is a JSON object keyed by name
  // (docs/SUPABASE_RULES.md §1). Preferred whenever present.
  const secretKeysRaw = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (secretKeysRaw !== undefined) {
    const parsed: unknown = JSON.parse(secretKeysRaw);
    if (!isRecord(parsed)) {
      throw new Error('SUPABASE_SECRET_KEYS is not a JSON object');
    }
    const secret = parsed['default'];
    if (typeof secret !== 'string' || secret === '') {
      throw new Error('SUPABASE_SECRET_KEYS has no "default" key');
    }
    return secret;
  }
  // Local CLI stack (`supabase start` / `functions serve`) predates the new
  // key model and injects only the legacy service key. Local-dev fallback
  // ONLY — the hosted path above always wins in production.
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy !== undefined && legacy !== '') {
    return legacy;
  }
  throw new Error('No server credential in environment (SUPABASE_SECRET_KEYS)');
}

export function createServiceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  if (url === undefined) {
    throw new Error('Missing SUPABASE_URL platform environment');
  }
  return createClient(url, resolveSecret(), { auth: { persistSession: false } });
}
