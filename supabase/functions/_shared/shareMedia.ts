/**
 * Share photo storage (Phase 10b, docs/SUPABASE_RULES.md §7): the private
 * share-media bucket is reachable only through the service client — these
 * helpers are the single path to it. URLs are short-lived and minted only
 * AFTER a caller's visibility rules selected the rows, so a URL can never
 * exist for content its viewer may not see.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { serverLog } from './logger.ts';

export const MEDIA_BUCKET = 'share-media';
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const SIGNED_URL_SECONDS = 600;

/**
 * Short-lived signed URLs for the given storage paths (batch). Failure
 * returns null → callers fail the request rather than serving a partial
 * feed.
 */
export async function signedUrlsFor(
  db: SupabaseClient,
  paths: readonly string[],
): Promise<Map<string, string> | null> {
  if (paths.length === 0) {
    return new Map();
  }
  const { data, error } = await db.storage
    .from(MEDIA_BUCKET)
    .createSignedUrls([...paths], SIGNED_URL_SECONDS);
  if (error !== null || data === null) {
    serverLog.error('share_media.sign_urls_failed', {});
    return null;
  }
  const map = new Map<string, string>();
  for (const item of data) {
    if (
      item.error === null &&
      item.path !== null &&
      item.signedUrl !== null &&
      item.signedUrl !== ''
    ) {
      map.set(item.path, item.signedUrl);
    }
  }
  return map;
}

/** Paths present on the given rows, for a batch signing call. */
export function imagePathsOf(rows: readonly { image_url: string | null }[]): string[] {
  return rows.map((r) => r.image_url).filter((path): path is string => path !== null);
}
