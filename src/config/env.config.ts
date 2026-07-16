/**
 * Validated access to client environment (CLAUDE.md §12: validate env at the
 * boundary). Lazy getters so modules can be imported (and tested) without the
 * full env present; the app fails loudly the moment a value is actually needed.
 */

/** Cloudflare's official always-pass TEST site key — public, dev-only. */
const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';

function required(name: 'VITE_SUPABASE_URL' | 'VITE_SUPABASE_PUBLISHABLE_KEY'): string {
  const value = import.meta.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing ${name} — copy .env.example to .env.local and fill it in`);
  }
  return value.trim();
}

export function supabaseUrl(): string {
  const value = required('VITE_SUPABASE_URL');
  const parsed = new URL(value); // throws on malformed input
  if (parsed.protocol !== 'https:' && parsed.hostname !== '127.0.0.1') {
    throw new Error('VITE_SUPABASE_URL must be https (or the local 127.0.0.1 stack)');
  }
  return value.replace(/\/$/, '');
}

export function publishableKey(): string {
  return required('VITE_SUPABASE_PUBLISHABLE_KEY');
}

export function turnstileSiteKey(): string {
  const value = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  if (value === undefined || value.trim() === '') {
    // Safe default: the always-pass test widget. The real key is a launch
    // requirement tracked in docs/KEYS_SETUP.md §2.
    return TURNSTILE_TEST_SITE_KEY;
  }
  return value.trim();
}
