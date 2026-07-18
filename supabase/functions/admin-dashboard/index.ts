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
import { programToday } from '../_shared/crownCheck.ts';

type Counts = {
  activeStudents: number;
  newFlags: number;
  highSeverityNewFlags: number;
  todaysCrownChecks: number;
};

async function gatherCounts(db: SupabaseClient): Promise<Counts | null> {
  // Student Mode test identities (staff_owner_admin_id set) are excluded from
  // the population tiles — they aren't real girls. Flag counts stay inclusive
  // on purpose: an admin testing the flag pipeline should see the tile react,
  // and the queue rows self-label via the "(Staff)" display name.
  const [students, flags, highFlags, crownChecks] = await Promise.all([
    db
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .is('staff_owner_admin_id', null),
    db.from('flags').select('id', { count: 'exact', head: true }).eq('status', 'new'),
    db
      .from('flags')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'new')
      .eq('severity', 'high'),
    // "Today" is the program-local day the checks themselves are keyed to
    // (check_date), so this tile flips at the girls' midnight, not UTC's.
    db
      .from('crown_checks')
      .select('id, students!inner(id)', { count: 'exact', head: true })
      .eq('check_date', programToday(new Date()))
      .is('students.staff_owner_admin_id', null),
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
