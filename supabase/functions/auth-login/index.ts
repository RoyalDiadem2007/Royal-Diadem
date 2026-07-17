/**
 * auth-login — PIN authentication for students (crown code + PIN) and admins
 * (email + PIN). The §8 pipeline, failing closed at every step:
 *
 *   CORS/method → Turnstile → rate limit → validate → credential check
 *   → COPPA consent gate → mint session → audit → minimal response.
 *
 * Every deny path returns the same generic `invalid_credentials` unless the
 * caller is entitled to more (rate limit, consent gate) — no account-existence
 * oracle. Every outcome, allowed or denied, lands in audit_logs.
 */
import bcrypt from 'npm:bcryptjs@3';
import { createServiceClient } from '../_shared/db.ts';
import { clientIp, errorResponse, handlePreflight, jsonResponse } from '../_shared/http.ts';
import { verifyTurnstile } from '../_shared/turnstile.ts';
import { clearIdentifierAttempts, enforceLoginRateLimit } from '../_shared/rateLimit.ts';
import { mintSession } from '../_shared/sessions.ts';
import { writeAudit } from '../_shared/audit.ts';
import { loginRequestSchema, parseJsonBody } from '../_shared/validate.ts';
import { serverLog } from '../_shared/logger.ts';

// Constant-work comparison target for unknown identifiers: keeps "no such
// user" timing-indistinguishable from "wrong PIN" (CLAUDE.md §6).
const DUMMY_PIN_HASH = bcrypt.hashSync('00000000', 12);

type AccountRow = {
  id: string;
  pin_hash: string;
  display_name: string;
  role: 'student' | 'super_admin' | 'mentor' | 'viewer';
  denyReason: string | null;
};

async function lookupStudent(
  db: ReturnType<typeof createServiceClient>,
  identifier: string,
): Promise<AccountRow | null> {
  const { data, error } = await db
    .from('students')
    .select('id, pin_hash, display_name, status, coppa_required, coppa_consent_status')
    .eq('login_code', identifier.toLowerCase())
    .maybeSingle();
  if (error !== null) {
    serverLog.error('login.student_lookup_failed', {});
    return null;
  }
  if (data === null) {
    return null;
  }
  let denyReason: string | null = null;
  if (data.status !== 'active') {
    denyReason = 'inactive';
  } else if (data.coppa_required === true && data.coppa_consent_status !== 'verified') {
    // COPPA gate (Spec §5): the account is unusable until a guardian's
    // consent is verified by an admin.
    denyReason = 'consent_pending';
  }
  return {
    id: String(data.id),
    pin_hash: String(data.pin_hash),
    display_name: String(data.display_name),
    role: 'student',
    denyReason,
  };
}

async function lookupAdmin(
  db: ReturnType<typeof createServiceClient>,
  identifier: string,
): Promise<AccountRow | null> {
  const { data, error } = await db
    .from('admin_users')
    .select('id, pin_hash, name, role')
    .eq('email', identifier.toLowerCase())
    .maybeSingle();
  if (error !== null) {
    serverLog.error('login.admin_lookup_failed', {});
    return null;
  }
  if (data === null) {
    return null;
  }
  const role = data.role;
  if (role !== 'super_admin' && role !== 'mentor' && role !== 'viewer') {
    return null;
  }
  return {
    id: String(data.id),
    pin_hash: String(data.pin_hash),
    display_name: String(data.name),
    role,
    denyReason: null,
  };
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
  const ip = clientIp(req);

  // 1. Validate input shape before doing anything with it.
  const rawBody = await parseJsonBody(req);
  const parsed = loginRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }
  const { subjectType, identifier, pin, turnstileToken } = parsed.data;

  // 2. Turnstile — gates who may even attempt (fail closed).
  const turnstile = await verifyTurnstile(turnstileToken, ip);
  if (!turnstile.ok) {
    await writeAudit(db, {
      actorType: 'system',
      actorId: null,
      actorRole: null,
      action: 'login',
      entityType: subjectType === 'student' ? 'student' : 'admin_user',
      entityId: null,
      outcome: 'denied',
      ip,
      metadata: { reason: `turnstile_${turnstile.reason}` },
    });
    return errorResponse(req, 403, 'bot_check_failed');
  }

  // 3. Rate limit — counts this attempt; deny with Retry-After when limited.
  const limit = await enforceLoginRateLimit(db, `${subjectType}:${identifier}`, ip);
  if (!limit.allowed) {
    await writeAudit(db, {
      actorType: 'system',
      actorId: null,
      actorRole: null,
      action: 'login',
      entityType: subjectType === 'student' ? 'student' : 'admin_user',
      entityId: null,
      outcome: 'denied',
      ip,
      metadata: { reason: `rate_${limit.reason}` },
    });
    return errorResponse(req, 429, 'too_many_attempts', {
      'Retry-After': String(limit.retryAfterSeconds),
    });
  }

  // 4. Credential check — constant-work whether or not the account exists.
  const account =
    subjectType === 'student' ? await lookupStudent(db, identifier) : await lookupAdmin(db, identifier);
  const pinMatches = await bcrypt.compare(pin, account?.pin_hash ?? DUMMY_PIN_HASH);
  const entityType = subjectType === 'student' ? 'student' : 'admin_user';

  if (account === null || !pinMatches) {
    await writeAudit(db, {
      actorType: 'system',
      actorId: null,
      actorRole: null,
      action: 'login',
      entityType,
      entityId: account?.id ?? null,
      outcome: 'denied',
      ip,
      metadata: { reason: 'bad_credentials' },
    });
    return errorResponse(req, 401, 'invalid_credentials');
  }

  // 5. Account-state gates (COPPA consent, inactive) — after the PIN check so
  // state information is only revealed to someone holding valid credentials.
  if (account.denyReason !== null) {
    await writeAudit(db, {
      actorType: subjectType,
      actorId: account.id,
      actorRole: account.role,
      action: 'login',
      entityType,
      entityId: account.id,
      outcome: 'denied',
      ip,
      metadata: { reason: account.denyReason },
    });
    const code = account.denyReason === 'consent_pending' ? 'consent_pending' : 'account_inactive';
    return errorResponse(req, 403, code);
  }

  // 6. Success: reset the identifier's limiter, mint the session, audit.
  await clearIdentifierAttempts(db, `${subjectType}:${identifier}`);
  const session = await mintSession(db, subjectType, account.id, ip, req.headers.get('user-agent'));
  if (session === null) {
    return errorResponse(req, 500, 'internal_error');
  }
  await writeAudit(db, {
    actorType: subjectType,
    actorId: account.id,
    actorRole: account.role,
    action: 'login',
    entityType,
    entityId: account.id,
    outcome: 'allowed',
    ip,
  });

  // Lets the client offer "Enable Face ID?" only when no passkey exists yet.
  const { count } = await db
    .from('webauthn_credentials')
    .select('id', { count: 'exact', head: true })
    .eq('subject_type', subjectType)
    .eq('subject_id', account.id);

  return jsonResponse(req, 200, {
    token: session.token,
    expiresAt: session.expiresAt,
    webauthnRegistered: (count ?? 0) > 0,
    subject: {
      type: subjectType,
      id: account.id,
      displayName: account.display_name,
      role: account.role,
    },
  });
});
