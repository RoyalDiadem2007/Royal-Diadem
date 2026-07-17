/**
 * Admin RBAC gate shared by every admin-only Edge Function (CLAUDE.md §17.2):
 * validates the opaque session, requires an admin subject, and re-reads the
 * role from admin_users on every call — the client is never trusted about who
 * it is. Every denial is audit-logged before the 401/403 goes out.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { bearerToken, clientIp, errorResponse } from './http.ts';
import { verifySession, type SessionSubject } from './sessions.ts';
import { writeAudit } from './audit.ts';
import { serverLog } from './logger.ts';

export type AdminRole = 'super_admin' | 'mentor' | 'viewer';

export type AdminContext = {
  subject: SessionSubject;
  role: AdminRole;
  ip: string | null;
};

export type AdminAuthResult =
  | { ok: true; ctx: AdminContext }
  | { ok: false; response: Response };

async function lookupRole(db: SupabaseClient, adminId: string): Promise<AdminRole | null> {
  const { data, error } = await db
    .from('admin_users')
    .select('role')
    .eq('id', adminId)
    .maybeSingle();
  if (error !== null) {
    serverLog.error('admin_auth.role_lookup_failed', {});
    return null; // fail closed
  }
  const role: unknown = data?.role;
  return role === 'super_admin' || role === 'mentor' || role === 'viewer' ? role : null;
}

/**
 * `entityType` names the resource for the audit trail of denied attempts.
 * `allowedRoles` narrows beyond "any admin" (least privilege, §17.2).
 */
export async function requireAdmin(
  db: SupabaseClient,
  req: Request,
  entityType: string,
  allowedRoles: readonly AdminRole[],
): Promise<AdminAuthResult> {
  const token = bearerToken(req);
  if (token === null) {
    return { ok: false, response: errorResponse(req, 401, 'missing_token') };
  }
  const ip = clientIp(req);

  const subject = await verifySession(db, token);
  if (subject === null) {
    return { ok: false, response: errorResponse(req, 401, 'invalid_session') };
  }

  if (subject.subjectType !== 'admin') {
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
    return { ok: false, response: errorResponse(req, 403, 'forbidden') };
  }

  const role = await lookupRole(db, subject.subjectId);
  if (role === null || !allowedRoles.includes(role)) {
    await writeAudit(db, {
      actorType: 'admin',
      actorId: subject.subjectId,
      actorRole: role,
      action: 'read',
      entityType,
      entityId: null,
      outcome: 'denied',
      ip,
    });
    return { ok: false, response: errorResponse(req, 403, 'forbidden') };
  }

  return { ok: true, ctx: { subject, role, ip } };
}
