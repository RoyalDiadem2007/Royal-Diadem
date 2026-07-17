/**
 * student-guardian-requests — the student's side of the consent ceremony
 * (OD-19 build B). GET returns her live pending guardian requests with the
 * consent code SHE decides whether to share; the notification IS the
 * knowledge. Emergency grants (super_admin crisis path) never appear here —
 * invisible to the student by design.
 */
import { createServiceClient } from '../_shared/db.ts';
import { errorResponse, handlePreflight, jsonResponse } from '../_shared/http.ts';
import { requireStudent } from '../_shared/studentAuth.ts';
import { writeAudit } from '../_shared/audit.ts';
import { serverLog } from '../_shared/logger.ts';

const ENTITY = 'guardian_access_request';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight !== null) {
    return preflight;
  }
  if (req.method !== 'GET') {
    return errorResponse(req, 405, 'method_not_allowed');
  }

  const db = createServiceClient();
  const auth = await requireStudent(db, req, ENTITY);
  if (!auth.ok) {
    return auth.response;
  }
  const { ctx } = auth;

  const { data, error } = await db
    .from('guardian_access_requests')
    .select('id, consent_code, code_expires_at, emergency, status, guardians!inner(guardian_name)')
    .eq('student_id', ctx.subject.subjectId)
    .eq('status', 'pending')
    .eq('emergency', false)
    .gt('code_expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (error !== null) {
    serverLog.error('student_guardian_requests.query_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  const requests = (
    data as unknown as {
      id: string;
      consent_code: string | null;
      code_expires_at: string | null;
      guardians: { guardian_name: string };
    }[]
  )
    .filter((row) => row.consent_code !== null && row.code_expires_at !== null)
    .map((row) => ({
      id: String(row.id),
      guardianName: String(row.guardians.guardian_name),
      code: String(row.consent_code),
      expiresAt: String(row.code_expires_at),
    }));

  await writeAudit(db, {
    actorType: 'student',
    actorId: ctx.subject.subjectId,
    actorRole: 'student',
    action: 'read',
    entityType: ENTITY,
    entityId: null,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { returned: requests.length },
  });

  return jsonResponse(req, 200, { requests });
});
