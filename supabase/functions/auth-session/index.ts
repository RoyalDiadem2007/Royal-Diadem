/**
 * auth-session — validates the presented session token and slides its idle
 * window. The client calls this on app start/resume to re-establish state
 * (the raw token lives in memory only, so a PWA resume needs a fresh check).
 */
import { createServiceClient } from '../_shared/db.ts';
import { bearerToken, errorResponse, handlePreflight, jsonResponse } from '../_shared/http.ts';
import { verifySession } from '../_shared/sessions.ts';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight !== null) {
    return preflight;
  }
  if (req.method !== 'GET') {
    return errorResponse(req, 405, 'method_not_allowed');
  }

  const token = bearerToken(req);
  if (token === null) {
    return errorResponse(req, 401, 'missing_token');
  }

  const db = createServiceClient();
  const subject = await verifySession(db, token);
  if (subject === null) {
    return errorResponse(req, 401, 'invalid_session');
  }

  return jsonResponse(req, 200, {
    subject: {
      type: subject.subjectType,
      id: subject.subjectId,
    },
    expiresAt: subject.expiresAt,
  });
});
