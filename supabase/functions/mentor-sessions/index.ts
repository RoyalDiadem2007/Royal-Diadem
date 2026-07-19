/**
 * mentor-sessions — the student's side of 1:1 mentor time (SXU "Your
 * people"). She proposes up to three preferred windows; staff confirm the
 * real time in the admin queue (admin-requests). One open ask at a time —
 * a gentle focus, mirrored by a partial unique index for races.
 *
 *   GET  /mentor-sessions          her recent requests, newest first
 *   POST /mentor-sessions/request  { preferredWindows: [{ date, slot }] }
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { z } from 'npm:zod@4';
import { createServiceClient } from '../_shared/db.ts';
import { errorResponse, handlePreflight, jsonResponse } from '../_shared/http.ts';
import { requireStudent, type StudentContext } from '../_shared/studentAuth.ts';
import { enforceSessionRequestRateLimit } from '../_shared/rateLimit.ts';
import { writeAudit } from '../_shared/audit.ts';
import { serverLog } from '../_shared/logger.ts';

const ENTITY = 'mentor_session_request';
const LIST_LIMIT = 5;
/** How far ahead a window may be proposed. */
const WINDOW_HORIZON_DAYS = 60;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()), 'not a real date');

const windowSchema = z
  .object({
    date: isoDate,
    slot: z.enum(['morning', 'afternoon', 'after_school', 'evening']),
  })
  .strict();

const createSchema = z
  .object({ preferredWindows: z.array(windowSchema).min(1).max(3) })
  .strict()
  .refine(
    (v) =>
      new Set(v.preferredWindows.map((w) => `${w.date}:${w.slot}`)).size ===
      v.preferredWindows.length,
    { message: 'duplicate windows' },
  );

/** YYYY-MM-DD `days` from now, UTC. */
function utcDaysAhead(days: number): string {
  const base = new Date();
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

type RequestRow = {
  id: string;
  status: string;
  preferred_windows: unknown;
  scheduled_date: string | null;
  scheduled_time: string | null;
  end_time: string | null;
  created_at: string;
};

/** Postgres `time` comes back HH:MM:SS; the wire format is HH:MM. */
function toWire(row: RequestRow) {
  return {
    id: String(row.id),
    status: row.status,
    preferredWindows: row.preferred_windows,
    scheduledDate: row.scheduled_date,
    scheduledTime: row.scheduled_time === null ? null : row.scheduled_time.slice(0, 5),
    endTime: row.end_time === null ? null : row.end_time.slice(0, 5),
    createdAt: row.created_at,
  };
}

const REQUEST_COLUMNS =
  'id, status, preferred_windows, scheduled_date, scheduled_time, end_time, created_at';

async function handleGet(db: SupabaseClient, req: Request, ctx: StudentContext): Promise<Response> {
  const { data, error } = await db
    .from('mentor_session_requests')
    .select(REQUEST_COLUMNS)
    .eq('student_id', ctx.subject.subjectId)
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT);
  if (error !== null) {
    serverLog.error('mentor_sessions.list_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  await writeAudit(db, {
    actorType: 'student',
    actorId: ctx.subject.subjectId,
    actorRole: 'student',
    action: 'read',
    entityType: ENTITY,
    entityId: null,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { returned: data.length },
  });

  return jsonResponse(req, 200, { requests: (data as RequestRow[]).map(toWire) });
}

async function handleCreate(
  db: SupabaseClient,
  req: Request,
  ctx: StudentContext,
  body: unknown,
): Promise<Response> {
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }
  // Windows must be upcoming: yesterday-UTC tolerates the student being in a
  // timezone behind UTC at her midnight; the horizon keeps asks concrete.
  const earliest = utcDaysAhead(-1);
  const latest = utcDaysAhead(WINDOW_HORIZON_DAYS);
  if (parsed.data.preferredWindows.some((w) => w.date < earliest || w.date > latest)) {
    return errorResponse(req, 400, 'invalid_request');
  }

  const rate = await enforceSessionRequestRateLimit(db, ctx.subject.subjectId);
  if (!rate.allowed) {
    return errorResponse(req, 429, 'rate_limited', {
      'Retry-After': String(rate.retryAfterSeconds),
    });
  }

  // One open ask at a time; the partial unique index backstops this check.
  const { count, error: countError } = await db
    .from('mentor_session_requests')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', ctx.subject.subjectId)
    .eq('status', 'pending');
  if (countError !== null || count === null) {
    serverLog.error('mentor_sessions.count_failed', {});
    return errorResponse(req, 500, 'server_error');
  }
  if (count > 0) {
    return errorResponse(req, 409, 'request_open');
  }

  const { data, error } = await db
    .from('mentor_session_requests')
    .insert({
      student_id: ctx.subject.subjectId,
      preferred_windows: parsed.data.preferredWindows,
    })
    .select('id')
    .single();
  if (error !== null) {
    // The unique index catching a race is a 409, not a server fault.
    if (error.code === '23505') {
      return errorResponse(req, 409, 'request_open');
    }
    serverLog.error('mentor_sessions.insert_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  await writeAudit(db, {
    actorType: 'student',
    actorId: ctx.subject.subjectId,
    actorRole: 'student',
    action: 'create',
    entityType: ENTITY,
    entityId: String(data.id),
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { windows: parsed.data.preferredWindows.length },
  });

  return jsonResponse(req, 201, { requestId: String(data.id) });
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight !== null) {
    return preflight;
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return errorResponse(req, 405, 'method_not_allowed');
  }

  const segments = new URL(req.url).pathname.split('/').filter((s) => s !== '');
  const action = segments.at(-1);

  const db = createServiceClient();
  const auth = await requireStudent(db, req, ENTITY);
  if (!auth.ok) {
    return auth.response;
  }

  if (req.method === 'GET') {
    return action === 'mentor-sessions'
      ? handleGet(db, req, auth.ctx)
      : errorResponse(req, 404, 'not_found');
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, 400, 'invalid_request');
  }

  if (action === 'request') {
    return handleCreate(db, req, auth.ctx, body);
  }
  return errorResponse(req, 404, 'not_found');
});
