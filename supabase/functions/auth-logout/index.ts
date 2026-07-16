/**
 * auth-logout — revokes the presented session (idempotent) and audits it.
 * Always 204 for a well-formed request: logout must never strand a user.
 */
import { createServiceClient } from '../_shared/db.ts';
import { bearerToken, clientIp, corsHeaders, errorResponse, handlePreflight } from '../_shared/http.ts';
import { revokeSession, verifySession } from '../_shared/sessions.ts';
import { writeAudit } from '../_shared/audit.ts';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight !== null) {
    return preflight;
  }
  if (req.method !== 'POST') {
    return errorResponse(req, 405, 'method_not_allowed');
  }

  const token = bearerToken(req);
  if (token === null) {
    return errorResponse(req, 401, 'missing_token');
  }

  const db = createServiceClient();
  const ip = clientIp(req);

  // Identify before revoking so the audit row names the actor.
  const subject = await verifySession(db, token);
  await revokeSession(db, token);

  if (subject !== null) {
    await writeAudit(db, {
      actorType: subject.subjectType,
      actorId: subject.subjectId,
      actorRole: subject.subjectType === 'student' ? 'student' : null,
      action: 'logout',
      entityType: 'session',
      entityId: subject.sessionId,
      outcome: 'allowed',
      ip,
    });
  }

  return new Response(null, { status: 204, headers: corsHeaders(req) });
});
