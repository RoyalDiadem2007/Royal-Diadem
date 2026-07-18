/**
 * student-mode — enters Student Mode for an admin (Maria, 2026-07-18):
 * provisions (once) a companion STAFF student row owned by the calling admin
 * and mints a real 'student' session bound to it, so an admin can try the
 * student experience and participate alongside the girls. Every student Edge
 * Function then works unchanged — writes land on the admin's own staff
 * identity, never a real girl's data. The staff row is inert as an account:
 * no login_code, an unusable random PIN hash, adult DOB (never
 * guardian-portal eligible), labeled/excluded via staff_owner_admin_id.
 *
 * super_admin + mentor only — viewer is a read-only role and gets no
 * write-capable student identity. Exit needs no endpoint: the client revokes
 * the student session through auth-logout and resumes its admin session.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import bcrypt from 'npm:bcryptjs@3';
import { createServiceClient } from '../_shared/db.ts';
import { errorResponse, handlePreflight, jsonResponse } from '../_shared/http.ts';
import { requireAdmin, type AdminContext } from '../_shared/adminAuth.ts';
import { enforceStudentModeRateLimit } from '../_shared/rateLimit.ts';
import { generatePin } from '../_shared/enrollment.ts';
import { mintSession } from '../_shared/sessions.ts';
import { writeAudit } from '../_shared/audit.ts';
import { serverLog } from '../_shared/logger.ts';

const ENTITY = 'student_mode';
const BCRYPT_COST = 12;
// Adult DOB: coppa_required stays false and the guardian portal's under-16
// eligibility can never match a staff identity.
const TEST_STUDENT_DOB = '2000-01-01';

type StaffStudent = { id: string; display_name: string };

async function findStaffStudent(db: SupabaseClient, adminId: string): Promise<StaffStudent | null> {
  const { data, error } = await db
    .from('students')
    .select('id, display_name')
    .eq('staff_owner_admin_id', adminId)
    .maybeSingle();
  if (error !== null) {
    serverLog.error('student_mode.lookup_failed', {});
    throw new Error('lookup_failed');
  }
  return data === null ? null : { id: String(data.id), display_name: String(data.display_name) };
}

/**
 * Creates the admin's staff student. The PIN hash is bcrypt of a discarded
 * random PIN — no credential exists that matches it, and with login_code null
 * the row is unreachable through auth-login regardless.
 */
async function provisionStaffStudent(
  db: SupabaseClient,
  adminId: string,
): Promise<StaffStudent | null> {
  const { data: adminRow, error: adminError } = await db
    .from('admin_users')
    .select('name')
    .eq('id', adminId)
    .maybeSingle();
  if (adminError !== null || adminRow === null) {
    serverLog.error('student_mode.admin_lookup_failed', {});
    return null;
  }
  const displayName = `${String(adminRow.name)} (Staff)`;
  const pinHash = await bcrypt.hash(generatePin(), BCRYPT_COST);

  const { data, error } = await db
    .from('students')
    .insert({
      first_name: String(adminRow.name),
      last_name: '(Staff)',
      display_name: displayName,
      date_of_birth: TEST_STUDENT_DOB,
      pin_hash: pinHash,
      status: 'active',
      coppa_required: false,
      coppa_consent_status: 'verified',
      staff_owner_admin_id: adminId,
    })
    .select('id, display_name')
    .maybeSingle();
  if (error !== null) {
    // A concurrent enter can win the partial unique index race; their row is
    // exactly the one we want.
    const existing = await findStaffStudent(db, adminId).catch(() => null);
    if (existing !== null) {
      return existing;
    }
    serverLog.error('student_mode.provision_failed', {});
    return null;
  }
  if (data === null) {
    serverLog.error('student_mode.provision_failed', {});
    return null;
  }
  return { id: String(data.id), display_name: String(data.display_name) };
}

async function enter(db: SupabaseClient, req: Request, ctx: AdminContext): Promise<Response> {
  const limit = await enforceStudentModeRateLimit(db, ctx.subject.subjectId);
  if (!limit.allowed) {
    return errorResponse(req, 429, 'too_many_attempts', {
      'Retry-After': String(limit.retryAfterSeconds),
    });
  }

  let student: StaffStudent | null;
  try {
    student = await findStaffStudent(db, ctx.subject.subjectId);
  } catch {
    return errorResponse(req, 500, 'server_error');
  }
  const provisioned = student === null;
  if (student === null) {
    student = await provisionStaffStudent(db, ctx.subject.subjectId);
  }
  if (student === null) {
    return errorResponse(req, 500, 'server_error');
  }

  const session = await mintSession(
    db,
    'student',
    student.id,
    ctx.ip,
    req.headers.get('user-agent'),
  );
  if (session === null) {
    return errorResponse(req, 500, 'server_error');
  }

  await writeAudit(db, {
    actorType: 'admin',
    actorId: ctx.subject.subjectId,
    actorRole: ctx.role,
    action: 'login',
    entityType: ENTITY,
    entityId: student.id,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { provisioned },
  });

  return jsonResponse(req, 200, {
    token: session.token,
    expiresAt: session.expiresAt,
    webauthnRegistered: false,
    staffMode: true,
    subject: {
      type: 'student',
      id: student.id,
      displayName: student.display_name,
      role: 'student',
    },
  });
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight !== null) {
    return preflight;
  }
  if (req.method !== 'POST') {
    return errorResponse(req, 405, 'method_not_allowed');
  }

  const db = createServiceClient();
  const auth = await requireAdmin(db, req, ENTITY, ['super_admin', 'mentor']);
  if (!auth.ok) {
    return auth.response;
  }
  return enter(db, req, auth.ctx);
});
