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
import { emailConfigured, sendEmail } from '../_shared/email.ts';
import {
  buildFirstLoginEmail,
  buildGuardianPortalEmail,
  issueMagicLink,
  linkRecipientForAge,
  withLink,
} from '../_shared/magicLinks.ts';
import {
  createStudentSchema,
  emergencyAccessSchema,
  importStudentsSchema,
  inviteGuardianSchema,
  parseJsonBody,
  resetPinSchema,
  sendLinkSchema,
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
  email: string | null;
};

const LIST_COLUMNS =
  'id, first_name, last_name, display_name, login_code, status, coppa_required, coppa_consent_status, phase, enrollment_date, email';

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
    email: row.email,
  };
}

/**
 * OD-19: an under-13's own email is never collected pre-consent — her
 * provisioning goes through the guardian. Rejecting here keeps the rule
 * server-side, not a form nicety.
 */
function emailAllowedForAge(input: CreateStudentRequest, coppaRequired: boolean): boolean {
  return !(coppaRequired && input.studentEmail !== undefined);
}

/** Creates the guardian record when the enrollment carried one. */
async function createGuardianIfPresent(
  db: SupabaseClient,
  studentId: string,
  input: CreateStudentRequest,
): Promise<boolean> {
  if (input.guardianName === undefined || input.guardianEmail === undefined) {
    return true;
  }
  const { error } = await db.from('guardians').insert({
    student_id: studentId,
    guardian_name: input.guardianName,
    relationship: input.guardianRelationship ?? 'parent',
    email: input.guardianEmail,
  });
  if (error !== null) {
    serverLog.error('admin_students.guardian_insert_failed', {});
    return false;
  }
  return true;
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
        email: input.studentEmail ?? null,
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
  if (!emailAllowedForAge(parsed.data, coppaRequired)) {
    return errorResponse(req, 400, 'invalid_request');
  }

  const inserted = await insertWithUniqueCode(db, parsed.data, pinHash, coppaRequired);
  if (inserted === null) {
    return errorResponse(req, 500, 'server_error');
  }
  if (!(await createGuardianIfPresent(db, inserted.row.id, parsed.data))) {
    // Student exists but the guardian record failed — surface it rather than
    // pretending the enrollment fully succeeded.
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
  | { index: number; ok: false; reason: 'duplicate' | 'server_error' | 'underage_email' };

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
  if (!emailAllowedForAge(row, coppaRequired)) {
    return { index, ok: false, reason: 'underage_email' };
  }

  const inserted = await insertWithUniqueCode(db, row, pinHash, coppaRequired);
  if (inserted === null) {
    return { index, ok: false, reason: 'server_error' };
  }
  if (!(await createGuardianIfPresent(db, inserted.row.id, row))) {
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

/**
 * (Re)sends the first-login magic link (OD-19). The recipient is decided by
 * age SERVER-SIDE: under-13 → guardian inbox (and only after verified
 * consent), 13+ → the student's own inbox. Failures are specific codes so the
 * admin UI can say exactly what's missing.
 */
async function handleSendLink(
  db: SupabaseClient,
  req: Request,
  ctx: AdminContext,
): Promise<Response> {
  const body = await parseJsonBody(req);
  const parsed = sendLinkSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }
  const { studentId } = parsed.data;

  const { data: student, error } = await db
    .from('students')
    .select('id, date_of_birth, email, status, coppa_required, coppa_consent_status')
    .eq('id', studentId)
    .maybeSingle();
  if (error !== null) {
    serverLog.error('admin_students.send_link_lookup_failed', {});
    return errorResponse(req, 500, 'server_error');
  }
  if (student === null) {
    return errorResponse(req, 404, 'not_found');
  }
  if (student.status !== 'active') {
    return errorResponse(req, 409, 'account_inactive');
  }
  if (!emailConfigured()) {
    return errorResponse(req, 503, 'email_not_configured');
  }

  const age = ageOn(String(student.date_of_birth), new Date());
  const recipient = linkRecipientForAge(age);

  let toAddress: string | null = null;
  let guardianId: string | null = null;
  if (recipient === 'student') {
    toAddress = typeof student.email === 'string' && student.email !== '' ? student.email : null;
    if (toAddress === null) {
      return errorResponse(req, 409, 'no_student_email');
    }
  } else {
    // Guardian-mediated setup: consent must be verified BEFORE any link goes
    // out (OD-19 ordering; the consent workflow itself is OD-10).
    if (student.coppa_required === true && student.coppa_consent_status !== 'verified') {
      return errorResponse(req, 409, 'consent_pending');
    }
    const { data: guardian, error: guardianError } = await db
      .from('guardians')
      .select('id, email')
      .eq('student_id', studentId)
      .not('email', 'is', null)
      .order('verification_timestamp', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (guardianError !== null) {
      serverLog.error('admin_students.send_link_guardian_failed', {});
      return errorResponse(req, 500, 'server_error');
    }
    if (guardian === null || typeof guardian.email !== 'string' || guardian.email === '') {
      return errorResponse(req, 409, 'no_guardian_email');
    }
    toAddress = guardian.email;
    guardianId = String(guardian.id);
  }

  const issued = await issueMagicLink(db, {
    studentId,
    recipient,
    guardianId,
    createdBy: ctx.subject.subjectId,
  });
  if (issued === null) {
    return errorResponse(req, 500, 'server_error');
  }

  const delivered = await sendEmail(withLink(buildFirstLoginEmail(toAddress, recipient), issued.token));
  if (!delivered) {
    // Undeliverable link must not stay claimable — revoke what we just made.
    await db
      .from('magic_links')
      .update({ revoked_at: new Date().toISOString() })
      .eq('student_id', studentId)
      .eq('recipient', recipient)
      .is('used_at', null)
      .is('revoked_at', null);
    return errorResponse(req, 502, 'email_send_failed');
  }

  await writeAudit(db, {
    actorType: 'admin',
    actorId: ctx.subject.subjectId,
    actorRole: ctx.role,
    action: 'create',
    entityType: 'magic_link',
    entityId: studentId,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { recipient },
  });

  return jsonResponse(req, 200, { sent: true, recipient, expiresAt: issued.expiresAt });
}

// Guardian portal eligibility (OD-19): under-16s. 13–15 by Maria's design;
// 11–12 included because the same portal is how a COPPA parent exercises the
// review right. 16+ students have no guardian access surface.
const GUARDIAN_PORTAL_MAX_AGE = 16;
const EMERGENCY_ACCESS_MINUTES = 60;

type PortalGuardian = { guardianId: string; name: string; email: string; accountId: string | null };

async function portalGuardianFor(
  db: SupabaseClient,
  studentId: string,
): Promise<PortalGuardian | null | 'error'> {
  const { data, error } = await db
    .from('guardians')
    .select('id, guardian_name, email, account_id')
    .eq('student_id', studentId)
    .not('email', 'is', null)
    .order('verification_timestamp', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (error !== null) {
    serverLog.error('admin_students.portal_guardian_lookup_failed', {});
    return 'error';
  }
  if (data === null || typeof data.email !== 'string' || data.email === '') {
    return null;
  }
  return {
    guardianId: String(data.id),
    name: String(data.guardian_name),
    email: data.email,
    accountId: data.account_id === null ? null : String(data.account_id),
  };
}

/**
 * Invites the student's guardian to the portal (OD-19 build B): find-or-create
 * the guardian_accounts identity (one login even with two daughters), link the
 * guardian row, email a guardian_portal magic link.
 */
async function handleInviteGuardian(
  db: SupabaseClient,
  req: Request,
  ctx: AdminContext,
): Promise<Response> {
  const parsed = inviteGuardianSchema.safeParse(await parseJsonBody(req));
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }
  const { studentId } = parsed.data;

  const { data: student, error } = await db
    .from('students')
    .select('id, date_of_birth, status')
    .eq('id', studentId)
    .maybeSingle();
  if (error !== null) {
    serverLog.error('admin_students.invite_lookup_failed', {});
    return errorResponse(req, 500, 'server_error');
  }
  if (student === null) {
    return errorResponse(req, 404, 'not_found');
  }
  if (student.status !== 'active') {
    return errorResponse(req, 409, 'account_inactive');
  }
  if (ageOn(String(student.date_of_birth), new Date()) >= GUARDIAN_PORTAL_MAX_AGE) {
    return errorResponse(req, 409, 'not_eligible');
  }
  if (!emailConfigured()) {
    return errorResponse(req, 503, 'email_not_configured');
  }

  const guardian = await portalGuardianFor(db, studentId);
  if (guardian === 'error') {
    return errorResponse(req, 500, 'server_error');
  }
  if (guardian === null) {
    return errorResponse(req, 409, 'no_guardian_email');
  }

  // Find-or-create the account identity by (lowercased) email.
  let accountId = guardian.accountId;
  if (accountId === null) {
    const email = guardian.email.toLowerCase();
    const { data: existing, error: findError } = await db
      .from('guardian_accounts')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (findError !== null) {
      serverLog.error('admin_students.account_find_failed', {});
      return errorResponse(req, 500, 'server_error');
    }
    if (existing !== null) {
      accountId = String(existing.id);
    } else {
      const { data: created, error: createError } = await db
        .from('guardian_accounts')
        .insert({ email, display_name: guardian.name })
        .select('id')
        .maybeSingle();
      if (createError !== null || created === null) {
        serverLog.error('admin_students.account_create_failed', {});
        return errorResponse(req, 500, 'server_error');
      }
      accountId = String(created.id);
    }
    const { error: linkError } = await db
      .from('guardians')
      .update({ account_id: accountId })
      .eq('id', guardian.guardianId);
    if (linkError !== null) {
      serverLog.error('admin_students.account_link_failed', {});
      return errorResponse(req, 500, 'server_error');
    }
  }

  const issued = await issueMagicLink(db, {
    studentId,
    recipient: 'guardian',
    guardianId: guardian.guardianId,
    createdBy: ctx.subject.subjectId,
    purpose: 'guardian_portal',
  });
  if (issued === null) {
    return errorResponse(req, 500, 'server_error');
  }

  const delivered = await sendEmail(withLink(buildGuardianPortalEmail(guardian.email), issued.token));
  if (!delivered) {
    await db
      .from('magic_links')
      .update({ revoked_at: new Date().toISOString() })
      .eq('student_id', studentId)
      .eq('recipient', 'guardian')
      .eq('purpose', 'guardian_portal')
      .is('used_at', null)
      .is('revoked_at', null);
    return errorResponse(req, 502, 'email_send_failed');
  }

  await writeAudit(db, {
    actorType: 'admin',
    actorId: ctx.subject.subjectId,
    actorRole: ctx.role,
    action: 'create',
    entityType: 'magic_link',
    entityId: studentId,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { recipient: 'guardian', purpose: 'guardian_portal' },
  });

  return jsonResponse(req, 200, { sent: true, expiresAt: issued.expiresAt });
}

/**
 * super_admin crisis path (OD-19): opens a guardian viewing window WITHOUT
 * the student's knowledge — no code, nothing in her app. Heavily audited;
 * whether she is told afterward is the OD-3 human protocol's call.
 */
async function handleEmergencyAccess(
  db: SupabaseClient,
  req: Request,
  ctx: AdminContext,
): Promise<Response> {
  const parsed = emergencyAccessSchema.safeParse(await parseJsonBody(req));
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }
  const { studentId } = parsed.data;

  const guardian = await portalGuardianFor(db, studentId);
  if (guardian === 'error') {
    return errorResponse(req, 500, 'server_error');
  }
  if (guardian === null || guardian.accountId === null) {
    // No portal identity to grant to — the guardian must be invited first.
    return errorResponse(req, 409, 'guardian_no_portal');
  }

  const accessExpiresAt = new Date(Date.now() + EMERGENCY_ACCESS_MINUTES * 60_000).toISOString();
  const { data: inserted, error } = await db
    .from('guardian_access_requests')
    .insert({
      account_id: guardian.accountId,
      guardian_id: guardian.guardianId,
      student_id: studentId,
      status: 'approved',
      emergency: true,
      granted_by: ctx.subject.subjectId,
      granted_at: new Date().toISOString(),
      access_expires_at: accessExpiresAt,
    })
    .select('id')
    .maybeSingle();
  if (error !== null || inserted === null) {
    serverLog.error('admin_students.emergency_grant_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  await writeAudit(db, {
    actorType: 'admin',
    actorId: ctx.subject.subjectId,
    actorRole: ctx.role,
    action: 'create',
    entityType: 'guardian_access_request',
    entityId: String(inserted.id),
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { studentId, emergency: true, minutes: EMERGENCY_ACCESS_MINUTES },
  });

  return jsonResponse(req, 201, { granted: true, accessExpiresAt });
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
  if (action === 'send-link' && req.method === 'POST') {
    return handleSendLink(db, req, auth.ctx);
  }
  if (action === 'invite-guardian' && req.method === 'POST') {
    return handleInviteGuardian(db, req, auth.ctx);
  }
  if (action === 'emergency-access' && req.method === 'POST') {
    // requireAdmin above is already ['super_admin']-only for this whole
    // function; if OD-6 ever widens that list, this route must stay
    // super_admin — the crisis path belongs to Kenecia alone.
    return handleEmergencyAccess(db, req, auth.ctx);
  }
  return errorResponse(req, 405, 'method_not_allowed');
});
