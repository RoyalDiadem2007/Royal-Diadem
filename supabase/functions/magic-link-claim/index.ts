/**
 * magic-link-claim — first login through an emailed link (Phase 4c, OD-19).
 *
 * The §8 pipeline, failing closed at every step:
 *   CORS/method → validate → Turnstile → rate limit → token check (hashed,
 *   single-use, unexpired, unrevoked) → account-state gates → issue a FRESH
 *   PIN (bcrypt; any earlier sessions revoked) → mark token used → mint
 *   session → audit → response.
 *
 * The PIN is generated here, at claim time, and crosses the wire exactly
 * once — the claim screen is the digital PIN card. For under-13 students the
 * link went to the guardian (set up together, student present); the session
 * minted is always the STUDENT's — guardians get no session of their own
 * until the access-portal build.
 */
import bcrypt from 'npm:bcryptjs@3';
import { createServiceClient } from '../_shared/db.ts';
import { clientIp, errorResponse, handlePreflight, jsonResponse } from '../_shared/http.ts';
import { verifyTurnstile } from '../_shared/turnstile.ts';
import { enforceClaimRateLimit } from '../_shared/rateLimit.ts';
import { mintSession } from '../_shared/sessions.ts';
import { writeAudit } from '../_shared/audit.ts';
import { sha256Hex } from '../_shared/hash.ts';
import { generatePin } from '../_shared/enrollment.ts';
import { claimLinkSchema, parseJsonBody } from '../_shared/validate.ts';
import { serverLog } from '../_shared/logger.ts';

const ENTITY = 'magic_link';
const BCRYPT_COST = 12;

type LinkRow = {
  id: string;
  student_id: string;
  recipient: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
};

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight !== null) {
    return preflight;
  }
  if (req.method !== 'POST') {
    return errorResponse(req, 405, 'method_not_allowed');
  }

  const db = createServiceClient();
  const ip = clientIp(req);

  const rawBody = await parseJsonBody(req);
  const parsed = claimLinkSchema.safeParse(rawBody);
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }
  const { token, turnstileToken } = parsed.data;

  const turnstile = await verifyTurnstile(turnstileToken, ip);
  if (!turnstile.ok) {
    await writeAudit(db, {
      actorType: 'system',
      actorId: null,
      actorRole: null,
      action: 'login',
      entityType: ENTITY,
      entityId: null,
      outcome: 'denied',
      ip,
      metadata: { reason: `turnstile_${turnstile.reason}` },
    });
    return errorResponse(req, 403, 'bot_check_failed');
  }

  const limit = await enforceClaimRateLimit(db, ip);
  if (!limit.allowed) {
    return errorResponse(req, 429, 'too_many_attempts', {
      'Retry-After': String(limit.retryAfterSeconds),
    });
  }

  const tokenHash = await sha256Hex(token);
  const { data: link, error: linkError } = await db
    .from('magic_links')
    .select('id, student_id, recipient, expires_at, used_at, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (linkError !== null) {
    serverLog.error('magic_link_claim.lookup_failed', {});
    return errorResponse(req, 500, 'server_error');
  }
  const row = link as LinkRow | null;
  const expired = row !== null && new Date(row.expires_at).getTime() <= Date.now();
  if (row === null || row.used_at !== null || row.revoked_at !== null || expired) {
    await writeAudit(db, {
      actorType: 'system',
      actorId: null,
      actorRole: null,
      action: 'login',
      entityType: ENTITY,
      entityId: row?.id ?? null,
      outcome: 'denied',
      ip,
      metadata: { reason: row === null ? 'unknown_token' : expired ? 'expired' : 'not_claimable' },
    });
    // One generic code for every unclaimable state — no token-state oracle.
    return errorResponse(req, 401, 'invalid_link');
  }

  const { data: student, error: studentError } = await db
    .from('students')
    .select('id, display_name, login_code, status, coppa_required, coppa_consent_status')
    .eq('id', row.student_id)
    .maybeSingle();
  if (studentError !== null || student === null) {
    serverLog.error('magic_link_claim.student_lookup_failed', {});
    return errorResponse(req, 500, 'server_error');
  }
  const consentBlocked =
    student.coppa_required === true && student.coppa_consent_status !== 'verified';
  if (student.status !== 'active' || consentBlocked) {
    await writeAudit(db, {
      actorType: 'student',
      actorId: String(student.id),
      actorRole: 'student',
      action: 'login',
      entityType: ENTITY,
      entityId: row.id,
      outcome: 'denied',
      ip,
      metadata: { reason: consentBlocked ? 'consent_pending' : 'inactive' },
    });
    return errorResponse(req, 403, consentBlocked ? 'consent_pending' : 'account_inactive');
  }

  // Claim the token FIRST, atomically — the guard predicates make a raced
  // double-claim lose here rather than double-issue credentials.
  const { data: claimed, error: claimError } = await db
    .from('magic_links')
    .update({ used_at: new Date().toISOString() })
    .eq('id', row.id)
    .is('used_at', null)
    .is('revoked_at', null)
    .select('id');
  if (claimError !== null) {
    serverLog.error('magic_link_claim.mark_used_failed', {});
    return errorResponse(req, 500, 'server_error');
  }
  if (claimed.length === 0) {
    return errorResponse(req, 401, 'invalid_link');
  }

  // Fresh PIN at claim time — the emailed link never contained a credential.
  const pin = generatePin();
  const pinHash = await bcrypt.hash(pin, BCRYPT_COST);
  const { error: pinError } = await db
    .from('students')
    .update({ pin_hash: pinHash })
    .eq('id', String(student.id));
  if (pinError !== null) {
    serverLog.error('magic_link_claim.pin_update_failed', {});
    return errorResponse(req, 500, 'server_error');
  }
  // Any session from an earlier credential dies with the old PIN (§17.2).
  const { error: revokeError } = await db
    .from('sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('subject_type', 'student')
    .eq('subject_id', String(student.id))
    .is('revoked_at', null);
  if (revokeError !== null) {
    serverLog.error('magic_link_claim.session_revoke_failed', {});
  }

  const session = await mintSession(db, 'student', String(student.id), ip, req.headers.get('user-agent'));
  if (session === null) {
    return errorResponse(req, 500, 'server_error');
  }

  await writeAudit(db, {
    actorType: 'student',
    actorId: String(student.id),
    actorRole: 'student',
    action: 'login',
    entityType: ENTITY,
    entityId: row.id,
    outcome: 'allowed',
    ip,
    metadata: { recipient: row.recipient },
  });

  const { count } = await db
    .from('webauthn_credentials')
    .select('id', { count: 'exact', head: true })
    .eq('subject_type', 'student')
    .eq('subject_id', String(student.id));

  // The one-time credential reveal: crown code + fresh PIN, shown once on the
  // claim screen (the digital PIN card), never emailed, never logged.
  return jsonResponse(req, 200, {
    token: session.token,
    expiresAt: session.expiresAt,
    webauthnRegistered: (count ?? 0) > 0,
    subject: {
      type: 'student',
      id: String(student.id),
      displayName: String(student.display_name),
      role: 'student',
    },
    credentials: {
      crownCode: String(student.login_code ?? '').toUpperCase(),
      pin,
    },
  });
});
