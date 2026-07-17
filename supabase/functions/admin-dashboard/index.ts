/**
 * admin-dashboard — at-a-glance counts for the admin panel (Spec §6.10
 * Dashboard). Server-side RBAC: requires a valid ADMIN session; the role is
 * re-read from admin_users on every call (never trusted from the client).
 * Returns aggregates only — no student contents ever cross this wire — and
 * every read (and every denied attempt) lands in the append-only audit log.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { createServiceClient } from '../_shared/db.ts';
import {
  bearerToken,
  clientIp,
  errorResponse,
  handlePreflight,
  jsonResponse,
} from '../_shared/http.ts';
import { verifySession } from '../_shared/sessions.ts';
import { writeAudit } from '../_shared/audit.ts';
import { serverLog } from '../_shared/logger.ts';

type AdminRole = 'super_admin' | 'mentor' | 'viewer';

async function adminRole(db: SupabaseClient, adminId: string): Promise<AdminRole | null> {
  const { data, error } = await db
    .from('admin_users')
    .select('role')
    .eq('id', adminId)
    .maybeSingle();
  if (error !== null) {
    serverLog.error('admin_dashboard.role_lookup_failed', {});
    return null; // fail closed
  }
  const role: unknown = data?.role;
  return role === 'super_admin' || role === 'mentor' || role === 'viewer' ? role : null;
}

type Counts = {
  activeStudents: number;
  newFlags: number;
  highSeverityNewFlags: number;
  todaysCrownChecks: number;
};

async function gatherCounts(db: SupabaseClient): Promise<Counts | null> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const [students, flags, highFlags, crownChecks] = await Promise.all([
    db.from('students').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    db.from('flags').select('id', { count: 'exact', head: true }).eq('status', 'new'),
    db
      .from('flags')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'new')
      .eq('severity', 'high'),
    db
      .from('crown_checks')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', todayStart.toISOString()),
  ]);

  for (const result of [students, flags, highFlags, crownChecks]) {
    if (result.error !== null || result.count === null) {
      serverLog.error('admin_dashboard.count_failed', {});
      return null;
    }
  }
  return {
    activeStudents: students.count ?? 0,
    newFlags: flags.count ?? 0,
    highSeverityNewFlags: highFlags.count ?? 0,
    todaysCrownChecks: crownChecks.count ?? 0,
  };
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight !== null) {
    return preflight;
  }
  if (req.method !== 'GET') {
    return errorResponse(req, 405, 'method_not_allowed');
  }

  const token = bearerToken(req);
  if (token === null) {
    return errorResponse(req, 401, 'missing_token');
  }

  const db = createServiceClient();
  const ip = clientIp(req);

  const subject = await verifySession(db, token);
  if (subject === null) {
    return errorResponse(req, 401, 'invalid_session');
  }

  if (subject.subjectType !== 'admin') {
    await writeAudit(db, {
      actorType: 'student',
      actorId: subject.subjectId,
      actorRole: 'student',
      action: 'read',
      entityType: 'admin_dashboard',
      entityId: null,
      outcome: 'denied',
      ip,
    });
    return errorResponse(req, 403, 'forbidden');
  }

  const role = await adminRole(db, subject.subjectId);
  if (role === null) {
    await writeAudit(db, {
      actorType: 'admin',
      actorId: subject.subjectId,
      actorRole: null,
      action: 'read',
      entityType: 'admin_dashboard',
      entityId: null,
      outcome: 'denied',
      ip,
    });
    return errorResponse(req, 403, 'forbidden');
  }

  const counts = await gatherCounts(db);
  if (counts === null) {
    return errorResponse(req, 500, 'server_error');
  }

  await writeAudit(db, {
    actorType: 'admin',
    actorId: subject.subjectId,
    actorRole: role,
    action: 'read',
    entityType: 'admin_dashboard',
    entityId: null,
    outcome: 'allowed',
    ip,
  });

  return jsonResponse(req, 200, { ...counts });
});
