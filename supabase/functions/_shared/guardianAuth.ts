/**
 * Guardian gate for portal Edge Functions (OD-19 build B), sibling of
 * adminAuth/studentAuth: validates the opaque session, requires a guardian
 * subject, and re-reads the guardian_accounts row on every call (a deleted or
 * un-claimed account dies immediately, not at token expiry). Every denial is
 * audit-logged before the 401/403 goes out.
 *
 * Holding a guardian session grants NOTHING about any student — student data
 * flows only through an access grant (consent ceremony or audited emergency).
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { bearerToken, clientIp, errorResponse } from './http.ts';
import { verifySession, type SessionSubject } from './sessions.ts';
import { writeAudit } from './audit.ts';
import { serverLog } from './logger.ts';

export type GuardianContext = {
  subject: SessionSubject;
  ip: string | null;
};

export type GuardianAuthResult =
  | { ok: true; ctx: GuardianContext }
  | { ok: false; response: Response };

export async function requireGuardian(
  db: SupabaseClient,
  req: Request,
  entityType: string,
): Promise<GuardianAuthResult> {
  const token = bearerToken(req);
  if (token === null) {
    return { ok: false, response: errorResponse(req, 401, 'missing_token') };
  }
  const ip = clientIp(req);

  const subject = await verifySession(db, token);
  if (subject === null) {
    return { ok: false, response: errorResponse(req, 401, 'invalid_session') };
  }

  if (subject.subjectType !== 'guardian') {
    await writeAudit(db, {
      actorType: subject.subjectType,
      actorId: subject.subjectId,
      actorRole: subject.subjectType === 'student' ? 'student' : null,
      action: 'read',
      entityType,
      entityId: null,
      outcome: 'denied',
      ip,
    });
    return { ok: false, response: errorResponse(req, 403, 'forbidden') };
  }

  const { data, error } = await db
    .from('guardian_accounts')
    .select('id, pin_hash')
    .eq('id', subject.subjectId)
    .maybeSingle();
  if (error !== null) {
    serverLog.error('guardian_auth.account_lookup_failed', {});
    return { ok: false, response: errorResponse(req, 500, 'server_error') };
  }
  if (data === null || data.pin_hash === null) {
    await writeAudit(db, {
      actorType: 'guardian',
      actorId: subject.subjectId,
      actorRole: 'guardian',
      action: 'read',
      entityType,
      entityId: null,
      outcome: 'denied',
      ip,
    });
    return { ok: false, response: errorResponse(req, 403, 'account_unavailable') };
  }

  return { ok: true, ctx: { subject, ip } };
}
