/**
 * Magic-link token extraction (OD-19). The token rides the URL fragment so
 * browsers never send it to any server; this is the only place it is parsed.
 */

/** Token from `#t=...`; null when the fragment carries none. */
export function tokenFromFragment(hash: string): string | null {
  const match = /^#t=([A-Za-z0-9_-]{20,200})$/.exec(hash);
  return match?.[1] ?? null;
}
