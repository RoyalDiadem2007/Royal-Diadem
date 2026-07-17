/**
 * push — web-push subscription management (VAPID).
 *   GET  /push/public-key    the VAPID public key (public by definition)
 *   POST /push/subscribe     store this device's push subscription for the
 *                            signed-in subject (student/admin/guardian)
 *   POST /push/unsubscribe   remove it
 *
 * Subscriptions are push-service routing material, not content; payloads sent
 * through _shared/push.ts are PII-free nudges. Every subscribe/unsubscribe is
 * audit-logged with ids only.
 */
import { z } from 'npm:zod@4';
import { createServiceClient } from '../_shared/db.ts';
import { bearerToken, clientIp, errorResponse, handlePreflight, jsonResponse } from '../_shared/http.ts';
import { verifySession } from '../_shared/sessions.ts';
import { writeAudit } from '../_shared/audit.ts';
import { serverLog } from '../_shared/logger.ts';
import { pushConfigured, vapidPublicKey } from '../_shared/push.ts';
import { parseJsonBody } from '../_shared/validate.ts';

const ENTITY = 'push_subscription';

const subscribeSchema = z
  .object({
    endpoint: z.url().max(2000),
    keys: z.object({ p256dh: z.string().min(10).max(300), auth: z.string().min(10).max(100) }),
  })
  .strict();

const unsubscribeSchema = z.object({ endpoint: z.url().max(2000) }).strict();

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight !== null) {
    return preflight;
  }

  const segments = new URL(req.url).pathname.split('/').filter((s) => s !== '');
  const action = segments.at(-1);

  if (action === 'public-key' && req.method === 'GET') {
    const key = vapidPublicKey();
    if (key === null) {
      return errorResponse(req, 503, 'push_not_configured');
    }
    return jsonResponse(req, 200, { publicKey: key });
  }
  if (req.method !== 'POST') {
    return errorResponse(req, 405, 'method_not_allowed');
  }
  if (!pushConfigured()) {
    return errorResponse(req, 503, 'push_not_configured');
  }

  const token = bearerToken(req);
  if (token === null) {
    return errorResponse(req, 401, 'missing_token');
  }
  const db = createServiceClient();
  const subject = await verifySession(db, token);
  if (subject === null) {
    return errorResponse(req, 401, 'invalid_session');
  }
  const ip = clientIp(req);
  const actorRole = subject.subjectType === 'admin' ? null : subject.subjectType;

  if (action === 'subscribe') {
    const parsed = subscribeSchema.safeParse(await parseJsonBody(req));
    if (!parsed.success) {
      return errorResponse(req, 400, 'invalid_request');
    }
    // Endpoint is unique: a device re-subscribing (or changing owner after a
    // shared-device sign-in) replaces the old row.
    const { error: clearError } = await db
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', parsed.data.endpoint);
    if (clearError !== null) {
      serverLog.error('push.replace_failed', {});
      return errorResponse(req, 500, 'server_error');
    }
    const { data, error } = await db
      .from('push_subscriptions')
      .insert({
        subject_type: subject.subjectType,
        subject_id: subject.subjectId,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
      })
      .select('id')
      .maybeSingle();
    if (error !== null || data === null) {
      serverLog.error('push.subscribe_failed', {});
      return errorResponse(req, 500, 'server_error');
    }

    await writeAudit(db, {
      actorType: subject.subjectType,
      actorId: subject.subjectId,
      actorRole,
      action: 'create',
      entityType: ENTITY,
      entityId: String(data.id),
      outcome: 'allowed',
      ip,
    });
    return jsonResponse(req, 201, { subscribed: true });
  }

  if (action === 'unsubscribe') {
    const parsed = unsubscribeSchema.safeParse(await parseJsonBody(req));
    if (!parsed.success) {
      return errorResponse(req, 400, 'invalid_request');
    }
    const { error } = await db
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', parsed.data.endpoint)
      .eq('subject_type', subject.subjectType)
      .eq('subject_id', subject.subjectId);
    if (error !== null) {
      serverLog.error('push.unsubscribe_failed', {});
      return errorResponse(req, 500, 'server_error');
    }

    await writeAudit(db, {
      actorType: subject.subjectType,
      actorId: subject.subjectId,
      actorRole,
      action: 'delete',
      entityType: ENTITY,
      entityId: null,
      outcome: 'allowed',
      ip,
    });
    return jsonResponse(req, 200, { subscribed: false });
  }

  return errorResponse(req, 405, 'method_not_allowed');
});
