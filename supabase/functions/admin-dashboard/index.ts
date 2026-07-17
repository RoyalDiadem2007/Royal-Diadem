/**
 * admin-dashboard — at-a-glance counts for the admin panel (Spec §6.10
 * Dashboard). Server-side RBAC via the shared requireAdmin gate (all three
 * admin roles may read — aggregates only, no student contents cross this
 * wire). Every read and every denied attempt lands in the audit log.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { createServiceClient } from '../_shared/db.ts';
import { errorResponse, handlePreflight, jsonResponse } from '../_shared/http.ts';
import { requireAdmin } from '../_shared/adminAuth.ts';
import { writeAudit } from '../_shared/audit.ts';
import { serverLog } from '../_shared/logger.ts';
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

  const db = createServiceClient();
  const auth = await requireAdmin(db, req, 'admin_dashboard', [
    'super_admin',
    'mentor',
    'viewer',
  ]);
  if (!auth.ok) {
    return auth.response;
  }

  const counts = await gatherCounts(db);
  if (counts === null) {
    return errorResponse(req, 500, 'server_error');
  }

  await writeAudit(db, {
    actorType: 'admin',
    actorId: auth.ctx.subject.subjectId,
    actorRole: auth.ctx.role,
    action: 'read',
    entityType: 'admin_dashboard',
    entityId: null,
    outcome: 'allowed',
    ip: auth.ctx.ip,
  });

  return jsonResponse(req, 200, { ...counts });
});
