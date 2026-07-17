/**
 * admin-students — Phase 4 enrollment (Spec §5/§6.10) + PIN reset (OD-9).
 *   GET  /admin-students             paginated roster
 *   POST /admin-students/create      individual add: generates crown code +
 *                                    PIN (bcrypt 12), computes COPPA from DOB
 *   POST /admin-students/reset-pin   regenerates the PIN, revokes the
 *                                    student's sessions (admin-initiated only)
 *
 * super_admin only until the mentor-assignment model lands (OD-6/OD-12).
 * Plaintext PINs travel to the enrolling admin exactly once (for the printed
 * card), are stored only as bcrypt hashes, and never appear in logs or audit
 * metadata. Every action and every denial is audit-logged.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import bcrypt from 'npm:bcryptjs@3';
import { createServiceClient } from '../_shared/db.ts';
import { errorResponse, handlePreflight, jsonResponse } from '../_shared/http.ts';
import { requireAdmin, type AdminContext } from '../_shared/adminAuth.ts';
import { writeAudit } from '../_shared/audit.ts';
import { serverLog } from '../_shared/logger.ts';
import { ageOn, generateCrownCode, generatePin } from '../_shared/enrollment.ts';
import {
  createStudentSchema,
  importStudentsSchema,
  parseJsonBody,
  resetPinSchema,
  type CreateStudentRequest,
} from '../_shared/validate.ts';

const ENTITY = 'student';
const PAGE_SIZE = 50;
const BCRYPT_COST = 12;
const CODE_RETRIES = 5;
const COPPA_AGE = 13;
const UNIQUE_VIOLATION = '23505';

type StudentRow = {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string;
  login_code: string | null;
  status: string;
  coppa_required: boolean;
  coppa_consent_status: string;
  phase: string | null;
  enrollment_date: string;
};

const LIST_COLUMNS =
  'id, first_name, last_name, display_name, login_code, status, coppa_required, coppa_consent_status, phase, enrollment_date';

function toWire(row: StudentRow) {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    displayName: row.display_name,
    // Stored lowercase (auth-login lowercases the typed identifier);
    // displayed/printed uppercase for the card.
    loginCode: row.login_code === null ? null : row.login_code.toUpperCase(),
    status: row.status,
    coppaRequired: row.coppa_required,
    coppaConsentStatus: row.coppa_consent_status,
    phase: row.phase,
    enrollmentDate: row.enrollment_date,
  };
}

async function handleList(
  db: SupabaseClient,
  req: Request,
  ctx: AdminContext,
): Promise<Response> {
  const pageParam = new URL(req.url).searchParams.get('page') ?? '1';
  const page = /^\d{1,6}$/.test(pageParam) ? Math.max(1, Number(pageParam)) : 1;
  const from = (page - 1) * PAGE_SIZE;

  const { data, error, count } = await db
    .from('students')
    .select(LIST_COLUMNS, { count: 'exact' })
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true })
    .range(from, from + PAGE_SIZE - 1);
  if (error !== null || count === null) {
    serverLog.error('admin_students.list_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  await writeAudit(db, {
    actorType: 'admin',
    actorId: ctx.subject.subjectId,
    actorRole: ctx.role,
    action: 'read',
    entityType: ENTITY,
    entityId: null,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { page, returned: data.length },
  });

  return jsonResponse(req, 200, {
    students: (data as StudentRow[]).map(toWire),
    page,
    pageSize: PAGE_SIZE,
    total: count,
  });
}

async function insertWithUniqueCode(
  db: SupabaseClient,
  input: CreateStudentRequest,
  pinHash: string,
  coppaRequired: boolean,
): Promise<{ row: StudentRow; loginCode: string } | null> {
  for (let attempt = 0; attempt < CODE_RETRIES; attempt += 1) {
    const loginCode = generateCrownCode();
    const { data, error } = await db
      .from('students')
      .insert({
        first_name: input.firstName,
        last_name: input.lastName,
        display_name: input.displayName,
        date_of_birth: input.dateOfBirth,
        grade_level: input.gradeLevel ?? null,
        school_name: input.schoolName ?? null,
        phase: input.phase ?? null,
        pin_hash: pinHash,
        login_code: loginCode.toLowerCase(),
        coppa_required: coppaRequired,
      })
      .select(LIST_COLUMNS)
      .single();
    if (error === null) {
      return { row: data as StudentRow, loginCode };
    }
    if (error.code !== UNIQUE_VIOLATION) {
      serverLog.error('admin_students.insert_failed', { dbCode: error.code ?? 'unknown' });
      return null;
    }
    // Crown-code collision (rare) — generate another and retry.
  }
  serverLog.error('admin_students.code_generation_exhausted', { retries: CODE_RETRIES });
  return null;
}

async function handleCreate(
  db: SupabaseClient,
  req: Request,
  ctx: AdminContext,
): Promise<Response> {
  const body = await parseJsonBody(req);
  const parsed = createStudentSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }

  const pin = generatePin();
  const pinHash = await bcrypt.hash(pin, BCRYPT_COST);
  const coppaRequired = ageOn(parsed.data.dateOfBirth, new Date()) < COPPA_AGE;

  const inserted = await insertWithUniqueCode(db, parsed.data, pinHash, coppaRequired);
  if (inserted === null) {
    return errorResponse(req, 500, 'server_error');
  }

  await writeAudit(db, {
    actorType: 'admin',
    actorId: ctx.subject.subjectId,
    actorRole: ctx.role,
    action: 'create',
    entityType: ENTITY,
    entityId: inserted.row.id,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { coppaRequired },
  });

  // The plaintext PIN goes back exactly once, over TLS, for the printed card.
  return jsonResponse(req, 201, { student: toWire(inserted.row), pin });
}

type ImportRowResult =
  | { index: number; ok: true; student: ReturnType<typeof toWire>; pin: string }
  | { index: number; ok: false; reason: 'duplicate' | 'server_error' };

/**
 * Enrolls one row of a CSV chunk. A same-name-and-DOB match is refused as a
 * duplicate so re-running an import can't double-enroll a cohort (§7
 * idempotency); everything else is identical to individual enrollment.
 */
async function importRow(
  db: SupabaseClient,
  ctx: AdminContext,
  row: CreateStudentRequest,
  index: number,
): Promise<ImportRowResult> {
  const { data: existing, error: dupError } = await db
    .from('students')
    .select('id')
    .eq('first_name', row.firstName)
    .eq('last_name', row.lastName)
    .eq('date_of_birth', row.dateOfBirth)
    .limit(1)
    .maybeSingle();
  if (dupError !== null) {
    serverLog.error('admin_students.import_dup_check_failed', {});
    return { index, ok: false, reason: 'server_error' };
  }
  if (existing !== null) {
    return { index, ok: false, reason: 'duplicate' };
  }

  const pin = generatePin();
  const pinHash = await bcrypt.hash(pin, BCRYPT_COST);
  const coppaRequired = ageOn(row.dateOfBirth, new Date()) < COPPA_AGE;

  const inserted = await insertWithUniqueCode(db, row, pinHash, coppaRequired);
  if (inserted === null) {
    return { index, ok: false, reason: 'server_error' };
  }

  await writeAudit(db, {
    actorType: 'admin',
    actorId: ctx.subject.subjectId,
    actorRole: ctx.role,
    action: 'create',
    entityType: ENTITY,
    entityId: inserted.row.id,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { coppaRequired, via: 'csv_import' },
  });

  return { index, ok: true, student: toWire(inserted.row), pin };
}

async function handleImport(
  db: SupabaseClient,
  req: Request,
  ctx: AdminContext,
): Promise<Response> {
  const body = await parseJsonBody(req, 50_000);
  const parsed = importStudentsSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }

  // Sequential on purpose: bcrypt is the cost, and parallel hashing would
  // spike the function's CPU ceiling without changing total work.
  const results: ImportRowResult[] = [];
  for (const [index, row] of parsed.data.rows.entries()) {
    results.push(await importRow(db, ctx, row, index));
  }

  return jsonResponse(req, 200, { results });
}

async function handleResetPin(
  db: SupabaseClient,
  req: Request,
  ctx: AdminContext,
): Promise<Response> {
  const body = await parseJsonBody(req);
  const parsed = resetPinSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }
  const { studentId } = parsed.data;

  const pin = generatePin();
  const pinHash = await bcrypt.hash(pin, BCRYPT_COST);

  const { data, error } = await db
    .from('students')
    .update({ pin_hash: pinHash })
    .eq('id', studentId)
    .select(LIST_COLUMNS)
    .maybeSingle();
  if (error !== null) {
    serverLog.error('admin_students.reset_failed', {});
    return errorResponse(req, 500, 'server_error');
  }
  if (data === null) {
    return errorResponse(req, 404, 'not_found');
  }

  // A reset PIN invalidates every live session for the student (§17.2).
  const { error: revokeError } = await db
    .from('sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('subject_type', 'student')
    .eq('subject_id', studentId)
    .is('revoked_at', null);
  if (revokeError !== null) {
    // The new hash is already in place; failing the whole request now would
    // strand the student with an unknown PIN. Loud log, request still fails
    // closed enough: old sessions die at idle timeout.
    serverLog.error('admin_students.session_revoke_failed', {});
  }

  await writeAudit(db, {
    actorType: 'admin',
    actorId: ctx.subject.subjectId,
    actorRole: ctx.role,
    action: 'update',
    entityType: ENTITY,
    entityId: studentId,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { operation: 'pin_reset' },
  });

  return jsonResponse(req, 200, { student: toWire(data as StudentRow), pin });
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight !== null) {
    return preflight;
  }

  const segments = new URL(req.url).pathname.split('/').filter((s) => s !== '');
  const action = segments.at(-1);

  const db = createServiceClient();
  const auth = await requireAdmin(db, req, ENTITY, ['super_admin']);
  if (!auth.ok) {
    return auth.response;
  }

  if (action === 'admin-students' && req.method === 'GET') {
    return handleList(db, req, auth.ctx);
  }
  if (action === 'create' && req.method === 'POST') {
    return handleCreate(db, req, auth.ctx);
  }
  if (action === 'import' && req.method === 'POST') {
    return handleImport(db, req, auth.ctx);
  }
  if (action === 'reset-pin' && req.method === 'POST') {
    return handleResetPin(db, req, auth.ctx);
  }
  return errorResponse(req, 405, 'method_not_allowed');
});
