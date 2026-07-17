/**
 * Web push sender (VAPID). Payloads are PII-free by contract — a title from
 * the brand config and a generic "open the app" line; every detail waits
 * inside the authenticated app. Send failures never break the caller's
 * request: push is a nudge, not a delivery guarantee. Dead endpoints
 * (404/410 from the push service) are pruned as they surface.
 *
 * Dependency note: npm:web-push is the reference implementation of the Web
 * Push protocol (VAPID JWT + aes128gcm payload encryption) — approved with
 * the VAPID wiring instruction (Maria, 2026-07-17).
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';
import { serverLog } from './logger.ts';

export type PushPayload = { title: string; body: string };

export function pushConfigured(): boolean {
  const pub = Deno.env.get('VAPID_PUBLIC_KEY');
  const priv = Deno.env.get('VAPID_PRIVATE_KEY');
  return pub !== undefined && pub !== '' && priv !== undefined && priv !== '';
}

export function vapidPublicKey(): string | null {
  const pub = Deno.env.get('VAPID_PUBLIC_KEY');
  return pub !== undefined && pub !== '' ? pub : null;
}

function configure(): boolean {
  const pub = Deno.env.get('VAPID_PUBLIC_KEY');
  const priv = Deno.env.get('VAPID_PRIVATE_KEY');
  if (pub === undefined || pub === '' || priv === undefined || priv === '') {
    return false;
  }
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com', pub, priv);
  return true;
}

const GONE_STATUSES = [404, 410];

/** Sends to every subscription the subject has. Never throws. */
export async function sendPushToSubject(
  db: SupabaseClient,
  subjectType: 'student' | 'admin' | 'guardian',
  subjectId: string,
  payload: PushPayload,
): Promise<void> {
  if (!configure()) {
    return; // push unconfigured = silently absent feature, not an error
  }
  const { data, error } = await db
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('subject_type', subjectType)
    .eq('subject_id', subjectId);
  if (error !== null) {
    serverLog.warn('push.subscription_query_failed', {});
    return;
  }

  for (const row of data as { id: string; endpoint: string; p256dh: string; auth: string }[]) {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        JSON.stringify(payload),
        { TTL: 3600 },
      );
    } catch (err) {
      const statusCode =
        typeof err === 'object' && err !== null && 'statusCode' in err
          ? Number((err as { statusCode: unknown }).statusCode)
          : 0;
      if (GONE_STATUSES.includes(statusCode)) {
        await db.from('push_subscriptions').delete().eq('id', row.id);
      } else {
        serverLog.warn('push.send_failed', { httpStatus: statusCode });
      }
    }
  }
}
