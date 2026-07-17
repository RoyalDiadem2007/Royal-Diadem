/**
 * admin-crown-checks — Crown Check trend views for the admin panel (Phase 5,
 * Spec §6.10 "Crown Checks": trend views per student, AI flag alerts).
 *   GET /admin-crown-checks                     roster of active students with
 *                                               their recent trend + a
 *                                               needs-review indicator
 *   GET /admin-crown-checks/student?studentId=  one student's recent series,
 *                                               notes included
 *
 * super_admin only until the mentor-assignment model lands (OD-6/OD-12) —
 * same rule as the Students section. Every read (and every denial, via the
 * shared gate) is audit-logged; notes cross this wire only in the per-student
 * detail, never in the roster.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { z } from 'npm:zod@4';
import { createServiceClient } from '../_shared/db.ts';
import { errorResponse, handlePreflight, jsonResponse } from '../_shared/http.ts';
import { requireAdmin, type AdminContext } from '../_shared/adminAuth.ts';
import { writeAudit } from '../_shared/audit.ts';
import { serverLog } from '../_shared/logger.ts';
import { programToday } from '../_shared/crownCheck.ts';

const ENTITY = 'crown_check';
const PAGE_SIZE = 50;
const ROSTER_TREND_DAYS = 14;
const DETAIL_LIMIT = 30;

type CheckRow = {
  id: string;
  student_id: string;
  check_date: string;
  mood_score: number;
  mood_emoji: string;
  note: string | null;
  ai_flag_triggered: boolean;
  ai_flag_reason: string | null;
};

/** YYYY-MM-DD shifted back `days` calendar days (date-string arithmetic). */
function daysBefore(isoDate: string, days: number): string {
  const base = new Date(`${isoDate}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() - days);
  return base.toISOString().slice(0, 10);
}

/**
 * Students whose crown checks carry an open (unresolved) AI flag. Open flags
 * are one-per-episode, so both queries stay tiny.
 */
async function studentsNeedingReview(db: SupabaseClient): Promise<Set<string> | null> {
  const { data: flags, error: flagError } = await db
    .from('flags')
    .select('entity_id')
    .eq('source', 'ai')
    .eq('entity_type', ENTITY)
    .neq('status', 'resolved');
  if (flagError !== null) {
    serverLog.error('admin_crown_checks.flag_query_failed', {});
    return null;
  }
  const checkIds = flags.map((f) => String(f.entity_id));
  if (checkIds.length === 0) {
    return new Set();
  }
  const { data: checks, error: checkError } = await db
    .from('crown_checks')
    .select('student_id')
    .in('id', checkIds);
  if (checkError !== null) {
    serverLog.error('admin_crown_checks.flag_owner_query_failed', {});
    return null;
  }
  return new Set(checks.map((c) => String(c.student_id)));
}

async function handleRoster(
  db: SupabaseClient,
  req: Request,
  ctx: AdminContext,
): Promise<Response> {
  const pageParam = new URL(req.url).searchParams.get('page') ?? '1';
  const page = /^\d{1,6}$/.test(pageParam) ? Math.max(1, Number(pageParam)) : 1;
  const from = (page - 1) * PAGE_SIZE;

  const { data: students, error, count } = await db
    .from('students')
    .select('id, display_name, first_name, last_name', { count: 'exact' })
    .eq('status', 'active')
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true })
    .range(from, from + PAGE_SIZE - 1);
  if (error !== null || count === null) {
    serverLog.error('admin_crown_checks.roster_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  const studentIds = students.map((s) => String(s.id));
  const windowStart = daysBefore(programToday(new Date()), ROSTER_TREND_DAYS - 1);

  let recentByStudent = new Map<string, CheckRow[]>();
  if (studentIds.length > 0) {
    const { data: checks, error: checksError } = await db
      .from('crown_checks')
      .select('id, student_id, check_date, mood_score, mood_emoji')
      .in('student_id', studentIds)
      .gte('check_date', windowStart)
      .order('check_date', { ascending: false });
    if (checksError !== null) {
      serverLog.error('admin_crown_checks.trend_query_failed', {});
      return errorResponse(req, 500, 'server_error');
    }
    recentByStudent = new Map();
    for (const raw of checks as Omit<CheckRow, 'note' | 'ai_flag_triggered' | 'ai_flag_reason'>[]) {
      const list = recentByStudent.get(raw.student_id) ?? [];
      list.push({ ...raw, note: null, ai_flag_triggered: false, ai_flag_reason: null });
      recentByStudent.set(raw.student_id, list);
    }
  }

  const needsReview = await studentsNeedingReview(db);
  if (needsReview === null) {
    return errorResponse(req, 500, 'server_error');
  }

  const roster = students.map((s) => {
    const id = String(s.id);
    const recent = recentByStudent.get(id) ?? [];
    const last = recent[0];
    return {
      studentId: id,
      displayName: String(s.display_name),
      firstName: String(s.first_name),
      lastName: String(s.last_name),
      lastCheck:
        last === undefined
          ? null
          : { checkDate: last.check_date, moodScore: last.mood_score, moodEmoji: last.mood_emoji },
      // Newest-first day/score pairs for the mini trend strip; no notes here.
      recent: recent.map((c) => ({ checkDate: c.check_date, moodScore: c.mood_score })),
      needsReview: needsReview.has(id),
    };
  });

  await writeAudit(db, {
    actorType: 'admin',
    actorId: ctx.subject.subjectId,
    actorRole: ctx.role,
    action: 'read',
    entityType: ENTITY,
    entityId: null,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { view: 'roster', page, returned: roster.length },
  });

  return jsonResponse(req, 200, { students: roster, page, pageSize: PAGE_SIZE, total: count });
}

const studentQuerySchema = z.object({ studentId: z.uuid() });

async function handleStudentDetail(
  db: SupabaseClient,
  req: Request,
  ctx: AdminContext,
): Promise<Response> {
  const parsed = studentQuerySchema.safeParse({
    studentId: new URL(req.url).searchParams.get('studentId'),
  });
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }
  const { studentId } = parsed.data;

  const { data: student, error: studentError } = await db
    .from('students')
    .select('id, display_name, first_name, last_name, status')
    .eq('id', studentId)
    .maybeSingle();
  if (studentError !== null) {
    serverLog.error('admin_crown_checks.student_lookup_failed', {});
    return errorResponse(req, 500, 'server_error');
  }
  if (student === null) {
    return errorResponse(req, 404, 'not_found');
  }

  const { data: checks, error: checksError } = await db
    .from('crown_checks')
    .select('id, student_id, check_date, mood_score, mood_emoji, note, ai_flag_triggered, ai_flag_reason')
    .eq('student_id', studentId)
    .order('check_date', { ascending: false })
    .limit(DETAIL_LIMIT);
  if (checksError !== null) {
    serverLog.error('admin_crown_checks.detail_query_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  const needsReview = await studentsNeedingReview(db);
  if (needsReview === null) {
    return errorResponse(req, 500, 'server_error');
  }

  await writeAudit(db, {
    actorType: 'admin',
    actorId: ctx.subject.subjectId,
    actorRole: ctx.role,
    action: 'read',
    entityType: ENTITY,
    entityId: studentId,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { view: 'student', returned: checks.length },
  });

  return jsonResponse(req, 200, {
    student: {
      studentId: String(student.id),
      displayName: String(student.display_name),
      firstName: String(student.first_name),
      lastName: String(student.last_name),
      status: String(student.status),
      needsReview: needsReview.has(String(student.id)),
    },
    checks: (checks as CheckRow[]).map((c) => ({
      id: c.id,
      checkDate: c.check_date,
      moodScore: c.mood_score,
      moodEmoji: c.mood_emoji,
      note: c.note,
      aiFlagTriggered: c.ai_flag_triggered,
      aiFlagReason: c.ai_flag_reason,
    })),
  });
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight !== null) {
    return preflight;
  }
  if (req.method !== 'GET') {
    return errorResponse(req, 405, 'method_not_allowed');
  }

  const segments = new URL(req.url).pathname.split('/').filter((s) => s !== '');
  const action = segments.at(-1);

  const db = createServiceClient();
  const auth = await requireAdmin(db, req, ENTITY, ['super_admin']);
  if (!auth.ok) {
    return auth.response;
  }

  if (action === 'admin-crown-checks') {
    return handleRoster(db, req, auth.ctx);
  }
  if (action === 'student') {
    return handleStudentDetail(db, req, auth.ctx);
  }
  return errorResponse(req, 404, 'not_found');
});
