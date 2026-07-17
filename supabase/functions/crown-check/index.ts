/**
 * crown-check — student daily emotional temp check (Phase 5, Spec §6.2).
 *   GET  /crown-check   today's check (if any) + her recent week
 *   POST /crown-check   submit today's check; same-day resubmits update in
 *                       place (one row per program-local day — her latest
 *                       feeling counts)
 *
 * After every write the pattern flag rule runs (Spec §7: threshold matching,
 * no AI interpretation): the last few consecutive low scores raise ONE
 * high-severity flag; while that flag is open, further low days do not spam
 * new ones. Flag state is never returned to the student — flags exist only in
 * the admin panel. Every access is audit-logged, denials included.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { createServiceClient } from '../_shared/db.ts';
import { errorResponse, handlePreflight, jsonResponse } from '../_shared/http.ts';
import { requireStudent, type StudentContext } from '../_shared/studentAuth.ts';
import { writeAudit } from '../_shared/audit.ts';
import { serverLog } from '../_shared/logger.ts';
import {
  consecutiveLowReason,
  CROWN_FLAG_SEVERITY,
  isConsecutiveLow,
  programToday,
} from '../_shared/crownCheck.ts';
import {
  parseJsonBody,
  submitCrownCheckSchema,
  type SubmitCrownCheckRequest,
} from '../_shared/validate.ts';

const ENTITY = 'crown_check';
const RECENT_DAYS = 7;
// How far back the open-flag dedupe looks for this student's flagged checks.
const FLAG_LOOKBACK_CHECKS = 90;
const UNIQUE_VIOLATION = '23505';

type CheckRow = {
  id: string;
  check_date: string;
  mood_score: number;
  mood_emoji: string;
  note: string | null;
};

const CHECK_COLUMNS = 'id, check_date, mood_score, mood_emoji, note';

/** Student-facing shape — deliberately excludes every ai_flag_* field. */
function toWire(row: CheckRow) {
  return {
    id: row.id,
    checkDate: row.check_date,
    moodScore: row.mood_score,
    moodEmoji: row.mood_emoji,
    note: row.note,
  };
}

async function handleGet(db: SupabaseClient, req: Request, ctx: StudentContext): Promise<Response> {
  const today = programToday(new Date());
  const { data, error } = await db
    .from('crown_checks')
    .select(CHECK_COLUMNS)
    .eq('student_id', ctx.subject.subjectId)
    .order('check_date', { ascending: false })
    .limit(RECENT_DAYS);
  if (error !== null) {
    serverLog.error('crown_check.list_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  const rows = data as CheckRow[];
  const todayRow = rows.find((row) => row.check_date === today) ?? null;

  await writeAudit(db, {
    actorType: 'student',
    actorId: ctx.subject.subjectId,
    actorRole: 'student',
    action: 'read',
    entityType: ENTITY,
    entityId: null,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { returned: rows.length },
  });

  return jsonResponse(req, 200, {
    today: todayRow === null ? null : toWire(todayRow),
    recent: rows.map(toWire),
  });
}

/** Inserts today's check, or updates it if it already exists (or raced in). */
async function upsertToday(
  db: SupabaseClient,
  studentId: string,
  today: string,
  input: SubmitCrownCheckRequest,
): Promise<{ row: CheckRow; created: boolean } | null> {
  const values = {
    mood_score: input.moodScore,
    mood_emoji: input.moodEmoji,
    // An omitted note on a resubmit clears the earlier one — the form always
    // sends the full current state of today's check.
    note: input.note ?? null,
  };

  const update = async (): Promise<CheckRow | null> => {
    const { data, error } = await db
      .from('crown_checks')
      .update(values)
      .eq('student_id', studentId)
      .eq('check_date', today)
      .select(CHECK_COLUMNS)
      .maybeSingle();
    if (error !== null) {
      serverLog.error('crown_check.update_failed', {});
      return null;
    }
    return data as CheckRow | null;
  };

  const { data: inserted, error: insertError } = await db
    .from('crown_checks')
    .insert({ student_id: studentId, check_date: today, ...values })
    .select(CHECK_COLUMNS)
    .maybeSingle();
  if (insertError === null && inserted !== null) {
    return { row: inserted as CheckRow, created: true };
  }
  if (insertError !== null && insertError.code !== UNIQUE_VIOLATION) {
    serverLog.error('crown_check.insert_failed', { dbCode: insertError.code ?? 'unknown' });
    return null;
  }

  // Today's row already exists (normal resubmit, or a same-moment race lost
  // to the unique index) — update it instead.
  const updated = await update();
  return updated === null ? null : { row: updated, created: false };
}

/**
 * Runs the consecutive-low rule after a write. Raises at most one open flag
 * per episode: while an unresolved AI flag exists on any of this student's
 * recent checks, low days keep updating the story but never re-alert.
 * Flag failures are loud in server logs yet do not fail the student's
 * submit — her check-in is already saved, and the rule re-runs on her next one.
 */
async function evaluateFlag(
  db: SupabaseClient,
  studentId: string,
  todayRow: CheckRow,
): Promise<boolean> {
  const { data, error } = await db
    .from('crown_checks')
    .select('id, mood_score')
    .eq('student_id', studentId)
    .order('check_date', { ascending: false })
    .limit(FLAG_LOOKBACK_CHECKS);
  if (error !== null) {
    serverLog.error('crown_check.flag_history_failed', {});
    return false;
  }
  const history = data as { id: string; mood_score: number }[];
  if (!isConsecutiveLow(history.map((row) => row.mood_score))) {
    return false;
  }

  const { data: openFlags, error: flagError } = await db
    .from('flags')
    .select('id')
    .eq('source', 'ai')
    .eq('entity_type', ENTITY)
    .in(
      'entity_id',
      history.map((row) => row.id),
    )
    .neq('status', 'resolved')
    .limit(1);
  if (flagError !== null) {
    serverLog.error('crown_check.flag_lookup_failed', {});
    return false;
  }
  if (openFlags.length > 0) {
    return false; // episode already flagged and still open — no re-alert
  }

  const { error: insertError } = await db.from('flags').insert({
    source: 'ai',
    entity_type: ENTITY,
    entity_id: todayRow.id,
    severity: CROWN_FLAG_SEVERITY,
  });
  if (insertError !== null) {
    serverLog.error('crown_check.flag_insert_failed', {});
    return false;
  }

  const { error: markError } = await db
    .from('crown_checks')
    .update({ ai_flag_triggered: true, ai_flag_reason: consecutiveLowReason() })
    .eq('id', todayRow.id);
  if (markError !== null) {
    serverLog.error('crown_check.flag_mark_failed', {});
  }
  return true;
}

async function handleSubmit(
  db: SupabaseClient,
  req: Request,
  ctx: StudentContext,
): Promise<Response> {
  const body = await parseJsonBody(req);
  const parsed = submitCrownCheckSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }

  const today = programToday(new Date());
  const result = await upsertToday(db, ctx.subject.subjectId, today, parsed.data);
  if (result === null) {
    return errorResponse(req, 500, 'server_error');
  }

  const flagged = await evaluateFlag(db, ctx.subject.subjectId, result.row);

  await writeAudit(db, {
    actorType: 'student',
    actorId: ctx.subject.subjectId,
    actorRole: 'student',
    action: result.created ? 'create' : 'update',
    entityType: ENTITY,
    entityId: result.row.id,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { flagRaised: flagged },
  });

  return jsonResponse(req, result.created ? 201 : 200, { check: toWire(result.row) });
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight !== null) {
    return preflight;
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return errorResponse(req, 405, 'method_not_allowed');
  }

  const db = createServiceClient();
  const auth = await requireStudent(db, req, ENTITY);
  if (!auth.ok) {
    return auth.response;
  }

  return req.method === 'GET'
    ? handleGet(db, req, auth.ctx)
    : handleSubmit(db, req, auth.ctx);
});
