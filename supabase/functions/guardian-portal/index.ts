/**
 * guardian-portal — the guardian's side of OD-19 build B.
 *   GET  /guardian-portal                 linked students + access state
 *   POST /guardian-portal/request-access  start the consent ceremony: creates
 *                                         a request whose 6-digit code appears
 *                                         in the STUDENT's app, never here
 *   POST /guardian-portal/enter-code      enter the code the student shared →
 *                                         opens a 30-minute viewing window
 *   GET  /guardian-portal/student?studentId=
 *                                         the student view, only inside an
 *                                         active window (ceremony or audited
 *                                         emergency grant)
 *
 * The student view is deliberately bounded for v1: profile basics + mood
 * trend (scores/emojis). Crown-check NOTE TEXT is excluded — journal/note
 * visibility arrives with Phase 6 under the same grant machinery. Every read
 * of student data is audit-logged with the guardian as actor.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { createServiceClient } from '../_shared/db.ts';
import { errorResponse, handlePreflight, jsonResponse } from '../_shared/http.ts';
import { requireGuardian, type GuardianContext } from '../_shared/guardianAuth.ts';
import { enforceCodeEntryRateLimit } from '../_shared/rateLimit.ts';
import { writeAudit } from '../_shared/audit.ts';
import { serverLog } from '../_shared/logger.ts';
import { generatePin } from '../_shared/enrollment.ts';
import { sha256Hex } from '../_shared/hash.ts';
import { enterCodeSchema, parseJsonBody, requestAccessSchema } from '../_shared/validate.ts';

const ENTITY = 'guardian_access_request';
const CODE_TTL_MINUTES = 10;
const ACCESS_WINDOW_MINUTES = 30;
const TREND_DAYS = 14;

type LinkedStudent = {
  guardianId: string;
  studentId: string;
  displayName: string;
};

async function linkedStudents(
  db: SupabaseClient,
  accountId: string,
): Promise<LinkedStudent[] | null> {
  const { data, error } = await db
    .from('guardians')
    .select('id, student_id, students!inner(id, display_name, status)')
    .eq('account_id', accountId);
  if (error !== null) {
    serverLog.error('guardian_portal.links_failed', {});
    return null;
  }
  const links: LinkedStudent[] = [];
  for (const row of data as unknown as {
    id: string;
    student_id: string;
    students: { id: string; display_name: string; status: string };
  }[]) {
    if (row.students.status === 'active') {
      links.push({
        guardianId: String(row.id),
        studentId: String(row.student_id),
        displayName: String(row.students.display_name),
      });
    }
  }
  return links;
}

type RequestRow = {
  id: string;
  status: string;
  emergency: boolean;
  consent_code: string | null;
  code_expires_at: string | null;
  granted_at: string | null;
  access_expires_at: string | null;
  created_at: string;
};

/** Latest request for this account+student, or null. */
async function latestRequest(
  db: SupabaseClient,
  accountId: string,
  studentId: string,
): Promise<RequestRow | null | 'error'> {
  const { data, error } = await db
    .from('guardian_access_requests')
    .select('id, status, emergency, consent_code, code_expires_at, granted_at, access_expires_at, created_at')
    .eq('account_id', accountId)
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error !== null) {
    serverLog.error('guardian_portal.request_lookup_failed', {});
    return 'error';
  }
  return data as RequestRow | null;
}

function accessState(row: RequestRow | null): { state: string; accessExpiresAt: string | null } {
  const now = Date.now();
  if (row === null) {
    return { state: 'none', accessExpiresAt: null };
  }
  if (
    row.status === 'approved' &&
    row.access_expires_at !== null &&
    new Date(row.access_expires_at).getTime() > now
  ) {
    return { state: 'active', accessExpiresAt: row.access_expires_at };
  }
  if (
    row.status === 'pending' &&
    !row.emergency &&
    row.code_expires_at !== null &&
    new Date(row.code_expires_at).getTime() > now
  ) {
    return { state: 'pending', accessExpiresAt: null };
  }
  return { state: 'none', accessExpiresAt: null };
}

async function handleList(
  db: SupabaseClient,
  req: Request,
  ctx: GuardianContext,
): Promise<Response> {
  const links = await linkedStudents(db, ctx.subject.subjectId);
  if (links === null) {
    return errorResponse(req, 500, 'server_error');
  }

  const students = [];
  for (const link of links) {
    const request = await latestRequest(db, ctx.subject.subjectId, link.studentId);
    if (request === 'error') {
      return errorResponse(req, 500, 'server_error');
    }
    students.push({
      studentId: link.studentId,
      displayName: link.displayName,
      ...accessState(request),
    });
  }

  await writeAudit(db, {
    actorType: 'guardian',
    actorId: ctx.subject.subjectId,
    actorRole: 'guardian',
    action: 'read',
    entityType: ENTITY,
    entityId: null,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { view: 'links', returned: students.length },
  });

  return jsonResponse(req, 200, { students });
}

/** Finds this account's link to the student, or null (not linked). */
async function linkFor(
  db: SupabaseClient,
  accountId: string,
  studentId: string,
): Promise<LinkedStudent | null | 'error'> {
  const links = await linkedStudents(db, accountId);
  if (links === null) {
    return 'error';
  }
  return links.find((l) => l.studentId === studentId) ?? null;
}

async function handleRequestAccess(
  db: SupabaseClient,
  req: Request,
  ctx: GuardianContext,
): Promise<Response> {
  const parsed = requestAccessSchema.safeParse(await parseJsonBody(req));
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }
  const { studentId } = parsed.data;

  const link = await linkFor(db, ctx.subject.subjectId, studentId);
  if (link === 'error') {
    return errorResponse(req, 500, 'server_error');
  }
  if (link === null) {
    await writeAudit(db, {
      actorType: 'guardian',
      actorId: ctx.subject.subjectId,
      actorRole: 'guardian',
      action: 'create',
      entityType: ENTITY,
      entityId: null,
      outcome: 'denied',
      ip: ctx.ip,
      metadata: { reason: 'not_linked' },
    });
    return errorResponse(req, 403, 'forbidden');
  }

  // An active window or live pending code just continues — no code churn.
  const existing = await latestRequest(db, ctx.subject.subjectId, studentId);
  if (existing === 'error') {
    return errorResponse(req, 500, 'server_error');
  }
  const state = accessState(existing);
  if (state.state !== 'none') {
    return jsonResponse(req, 200, { state: state.state, accessExpiresAt: state.accessExpiresAt });
  }

  const code = generatePin(); // 6 unbiased digits, same generator as PINs
  const { data: inserted, error } = await db
    .from('guardian_access_requests')
    .insert({
      account_id: ctx.subject.subjectId,
      guardian_id: link.guardianId,
      student_id: studentId,
      consent_code: code,
      code_expires_at: new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString(),
    })
    .select('id')
    .maybeSingle();
  if (error !== null || inserted === null) {
    serverLog.error('guardian_portal.request_insert_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  await writeAudit(db, {
    actorType: 'guardian',
    actorId: ctx.subject.subjectId,
    actorRole: 'guardian',
    action: 'create',
    entityType: ENTITY,
    entityId: String(inserted.id),
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { studentId },
  });

  // The code goes to the STUDENT's app, never back to the guardian.
  return jsonResponse(req, 201, { state: 'pending', accessExpiresAt: null });
}

async function handleEnterCode(
  db: SupabaseClient,
  req: Request,
  ctx: GuardianContext,
): Promise<Response> {
  const parsed = enterCodeSchema.safeParse(await parseJsonBody(req));
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }
  const { studentId, code } = parsed.data;

  const limit = await enforceCodeEntryRateLimit(db, ctx.subject.subjectId);
  if (!limit.allowed) {
    return errorResponse(req, 429, 'too_many_attempts', {
      'Retry-After': String(limit.retryAfterSeconds),
    });
  }

  const request = await latestRequest(db, ctx.subject.subjectId, studentId);
  if (request === 'error') {
    return errorResponse(req, 500, 'server_error');
  }
  const pending =
    request !== null &&
    request.status === 'pending' &&
    !request.emergency &&
    request.consent_code !== null &&
    request.code_expires_at !== null &&
    new Date(request.code_expires_at).getTime() > Date.now();

  // Hash both sides before comparing — equal work either way (§6
  // constant-time comparison for secrets), with the rate limiter above as the
  // real guessing barrier.
  const matches =
    pending &&
    (await sha256Hex(code)) === (await sha256Hex(String(request.consent_code)));

  if (!matches) {
    await writeAudit(db, {
      actorType: 'guardian',
      actorId: ctx.subject.subjectId,
      actorRole: 'guardian',
      action: 'update',
      entityType: ENTITY,
      entityId: request?.id ?? null,
      outcome: 'denied',
      ip: ctx.ip,
      metadata: { reason: pending ? 'wrong_code' : 'no_pending_request' },
    });
    return errorResponse(req, 401, 'invalid_code');
  }

  const accessExpiresAt = new Date(Date.now() + ACCESS_WINDOW_MINUTES * 60_000).toISOString();
  const { error } = await db
    .from('guardian_access_requests')
    .update({
      status: 'approved',
      granted_at: new Date().toISOString(),
      access_expires_at: accessExpiresAt,
      consent_code: null, // single-use: the code dies the moment it works
    })
    .eq('id', String(request.id))
    .eq('status', 'pending');
  if (error !== null) {
    serverLog.error('guardian_portal.grant_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  await writeAudit(db, {
    actorType: 'guardian',
    actorId: ctx.subject.subjectId,
    actorRole: 'guardian',
    action: 'update',
    entityType: ENTITY,
    entityId: String(request.id),
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { studentId, grant: 'consent_code' },
  });

  return jsonResponse(req, 200, { state: 'active', accessExpiresAt });
}

async function handleStudentView(
  db: SupabaseClient,
  req: Request,
  ctx: GuardianContext,
): Promise<Response> {
  const studentId = new URL(req.url).searchParams.get('studentId') ?? '';
  if (!/^[0-9a-f-]{36}$/.test(studentId)) {
    return errorResponse(req, 400, 'invalid_request');
  }

  const request = await latestRequest(db, ctx.subject.subjectId, studentId);
  if (request === 'error') {
    return errorResponse(req, 500, 'server_error');
  }
  const state = accessState(request);
  if (state.state !== 'active' || request === null) {
    await writeAudit(db, {
      actorType: 'guardian',
      actorId: ctx.subject.subjectId,
      actorRole: 'guardian',
      action: 'read',
      entityType: 'student',
      entityId: studentId,
      outcome: 'denied',
      ip: ctx.ip,
      metadata: { reason: 'no_active_grant' },
    });
    return errorResponse(req, 403, 'no_active_grant');
  }

  const { data: student, error: studentError } = await db
    .from('students')
    .select('id, display_name, first_name, last_name, status, phase, enrollment_date')
    .eq('id', studentId)
    .maybeSingle();
  if (studentError !== null || student === null) {
    serverLog.error('guardian_portal.student_lookup_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  const windowStart = new Date(Date.now() - TREND_DAYS * 86_400_000).toISOString().slice(0, 10);
  const { data: checks, error: checksError } = await db
    .from('crown_checks')
    // v1 boundary: scores and emojis only — never the note text (see header).
    .select('check_date, mood_score, mood_emoji')
    .eq('student_id', studentId)
    .gte('check_date', windowStart)
    .order('check_date', { ascending: false });
  if (checksError !== null) {
    serverLog.error('guardian_portal.trend_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  await writeAudit(db, {
    actorType: 'guardian',
    actorId: ctx.subject.subjectId,
    actorRole: 'guardian',
    action: 'read',
    entityType: 'student',
    entityId: studentId,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { via: request.emergency ? 'emergency_grant' : 'consent_grant' },
  });

  return jsonResponse(req, 200, {
    student: {
      studentId: String(student.id),
      displayName: String(student.display_name),
      firstName: String(student.first_name),
      lastName: String(student.last_name),
      status: String(student.status),
      phase: student.phase === null ? null : String(student.phase),
      enrollmentDate: String(student.enrollment_date),
    },
    trend: (checks as { check_date: string; mood_score: number; mood_emoji: string }[]).map(
      (c) => ({ checkDate: c.check_date, moodScore: c.mood_score, moodEmoji: c.mood_emoji }),
    ),
    accessExpiresAt: state.accessExpiresAt,
  });
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight !== null) {
    return preflight;
  }

  const segments = new URL(req.url).pathname.split('/').filter((s) => s !== '');
  const action = segments.at(-1);

  const db = createServiceClient();
  const auth = await requireGuardian(db, req, ENTITY);
  if (!auth.ok) {
    return auth.response;
  }

  if (action === 'guardian-portal' && req.method === 'GET') {
    return handleList(db, req, auth.ctx);
  }
  if (action === 'request-access' && req.method === 'POST') {
    return handleRequestAccess(db, req, auth.ctx);
  }
  if (action === 'enter-code' && req.method === 'POST') {
    return handleEnterCode(db, req, auth.ctx);
  }
  if (action === 'student' && req.method === 'GET') {
    return handleStudentView(db, req, auth.ctx);
  }
  return errorResponse(req, 405, 'method_not_allowed');
});
