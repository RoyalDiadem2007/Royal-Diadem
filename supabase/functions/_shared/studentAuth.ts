/**
 * Student gate shared by student-facing Edge Functions, the counterpart of
 * adminAuth.ts: validates the opaque session, requires a student subject, and
 * re-reads the student row on every call — a session must die the moment an
 * account is deactivated or COPPA consent is withdrawn, not at token expiry
 * (CLAUDE.md §17.2). Every denial is audit-logged before the 401/403 goes out.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { bearerToken, clientIp, errorResponse } from './http.ts';
import { verifySession, type SessionSubject } from './sessions.ts';
import { writeAudit } from './audit.ts';
import { serverLog } from './logger.ts';

export type StudentContext = {
  subject: SessionSubject;
  ip: string | null;
};

export type StudentAuthResult =
  | { ok: true; ctx: StudentContext }
  | { ok: false; response: Response };

type StudentStanding = { active: boolean };

async function lookupStanding(
  db: SupabaseClient,
  studentId: string,
): Promise<StudentStanding | null> {
  const { data, error } = await db
    .from('students')
    .select('status, coppa_required, coppa_consent_status')
    .eq('id', studentId)
    .maybeSingle();
  if (error !== null) {
    serverLog.error('student_auth.standing_lookup_failed', {});
    return null; // fail closed
  }
  if (data === null) {
    return null;
  }
  const consentOk = data.coppa_required !== true || data.coppa_consent_status === 'verified';
  return { active: data.status === 'active' && consentOk };
}

/** `entityType` names the resource for the audit trail of denied attempts. */
export async function requireStudent(
  db: SupabaseClient,
  req: Request,
  entityType: string,
): Promise<StudentAuthResult> {
  const token = bearerToken(req);
  if (token === null) {
    return { ok: false, response: errorResponse(req, 401, 'missing_token') };
  }
  const ip = clientIp(req);

  const subject = await verifySession(db, token);
  if (subject === null) {
    return { ok: false, response: errorResponse(req, 401, 'invalid_session') };
  }

  if (subject.subjectType !== 'student') {
    await writeAudit(db, {
      actorType: 'admin',
      actorId: subject.subjectId,
      actorRole: null,
      action: 'read',
      entityType,
      entityId: null,
      outcome: 'denied',
      ip,
    });
    return { ok: false, response: errorResponse(req, 403, 'forbidden') };
  }

  const standing = await lookupStanding(db, subject.subjectId);
  if (standing === null || !standing.active) {
    await writeAudit(db, {
      actorType: 'student',
      actorId: subject.subjectId,
      actorRole: 'student',
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
