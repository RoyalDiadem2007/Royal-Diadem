/**
 * Client-side web push enrollment (VAPID). The subscription is push-service
 * routing material; payloads the server sends are PII-free nudges. Nothing
 * here stores anything on the device beyond the browser's own push
 * subscription.
 */
import { callEdgeFunction, type ApiResult } from '@/lib/api';
import { logger } from '@/lib/logger';

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function notificationPermission(): NotificationPermission | null {
  return pushSupported() ? Notification.permission : null;
}

/** Standard VAPID key conversion (base64url → bytes for subscribe()). */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replaceAll('-', '+').replaceAll('_', '/');
  const raw = atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

function parsePublicKey(raw: unknown): string {
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !('publicKey' in raw) ||
    typeof raw.publicKey !== 'string' ||
    raw.publicKey === ''
  ) {
    throw new Error('public key response is malformed');
  }
  return raw.publicKey;
}

async function fetchPublicKey(): Promise<ApiResult<string>> {
  return callEdgeFunction('push/public-key', { method: 'GET', parse: parsePublicKey });
}

export type EnableResult = { ok: true } | { ok: false; reason: 'denied' | 'unavailable' };

/**
 * Full enrollment: permission prompt → browser subscription → server
 * registration. Returns 'denied' only when the user said no; every technical
 * failure is 'unavailable' (retryable later, never an error screen).
 */
export async function enablePushNotifications(sessionToken: string): Promise<EnableResult> {
  if (!pushSupported()) {
    return { ok: false, reason: 'unavailable' };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { ok: false, reason: 'denied' };
  }

  const keyResult = await fetchPublicKey();
  if (!keyResult.ok) {
    return { ok: false, reason: 'unavailable' };
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(keyResult.data),
    });
    const json = subscription.toJSON();
    if (
      typeof json.endpoint !== 'string' ||
      json.keys?.p256dh === undefined ||
      json.keys.auth === undefined
    ) {
      return { ok: false, reason: 'unavailable' };
    }
    const saved = await callEdgeFunction('push/subscribe', {
      method: 'POST',
      sessionToken,
      body: { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } },
      parse: () => null,
    });
    if (!saved.ok) {
      return { ok: false, reason: 'unavailable' };
    }
    logger.info('push.enabled', {});
    return { ok: true };
  } catch {
    // Browser refused the subscription (e.g. iOS not installed to home
    // screen yet) — recoverable, not an error state.
    return { ok: false, reason: 'unavailable' };
  }
}
