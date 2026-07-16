/**
 * auth-webauthn-login — usernameless passkey sign-in.
 *
 *   POST /options — generate an authentication challenge (no session needed)
 *   POST /verify  — verify the assertion, check the signature counter, mint a
 *                   session, audit
 *
 * No Turnstile here, deliberately: unlike a 4-8 digit PIN, a WebAuthn
 * assertion is an unforgeable cryptographic challenge-response — there is
 * nothing for a bot to brute-force. IP rate limiting still applies to both
 * steps (CLAUDE.md §10), and a non-increasing signature counter (cloned
 * authenticator signal) revokes trust in the credential outright.
 */
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
} from 'npm:@simplewebauthn/server@13';
import { createServiceClient } from '../_shared/db.ts';
import { clientIp, errorResponse, handlePreflight, jsonResponse } from '../_shared/http.ts';
import { mintSession } from '../_shared/sessions.ts';
import { writeAudit } from '../_shared/audit.ts';
import { parseJsonBody } from '../_shared/validate.ts';
import {
  consumeChallenge,
  findCredentialById,
  relyingParty,
  storeChallenge,
  toTransports,
} from '../_shared/webauthn.ts';
import { serverLog } from '../_shared/logger.ts';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

function subPath(req: Request): string {
  const segments = new URL(req.url).pathname.split('/').filter((s) => s !== '');
  return segments[segments.length - 1] ?? '';
}

function isAuthenticationResponse(body: unknown): body is AuthenticationResponseJSON {
  return (
    typeof body === 'object' &&
    body !== null &&
    'id' in body &&
    typeof body.id === 'string' &&
    'response' in body &&
    typeof body.response === 'object'
  );
}

const IP_POLICY = { p_max_attempts: 20, p_window_seconds: 900, p_lockout_seconds: 900 };

async function ipLimited(db: SupabaseClient, ip: string | null): Promise<number | null> {
  if (ip === null) {
    return null;
  }
  const { data, error } = await db.rpc('record_auth_attempt', {
    p_key: `webauthn:ip:${ip.toLowerCase()}`,
    ...IP_POLICY,
  });
  if (error !== null || !Array.isArray(data) || data.length === 0) {
    serverLog.error('webauthn.rate_limit_unavailable', {});
    return 60; // fail closed
  }
  const row: unknown = data[0];
  if (typeof row === 'object' && row !== null && 'allowed' in row && row.allowed === true) {
    return null;
  }
  const retry =
    typeof row === 'object' && row !== null && 'retry_after_seconds' in row
      ? Number(row.retry_after_seconds)
      : 900;
  return Number.isFinite(retry) && retry > 0 ? retry : 900;
}

type SubjectDetails = { displayName: string; role: 'student' | 'super_admin' | 'mentor' | 'viewer' };

async function loadSubject(
  db: SupabaseClient,
  subjectType: 'student' | 'admin',
  subjectId: string,
): Promise<SubjectDetails | null> {
  if (subjectType === 'student') {
    const { data, error } = await db
      .from('students')
      .select('display_name, status, coppa_required, coppa_consent_status')
      .eq('id', subjectId)
      .maybeSingle();
    if (error !== null || data === null) {
      return null;
    }
    // Same gates as PIN login: an inactive or consent-pending account cannot
    // sign in with a passkey either.
    if (data.status !== 'active') {
      return null;
    }
    if (data.coppa_required === true && data.coppa_consent_status !== 'verified') {
      return null;
    }
    return { displayName: String(data.display_name), role: 'student' };
  }
  const { data, error } = await db
    .from('admin_users')
    .select('name, role')
    .eq('id', subjectId)
    .maybeSingle();
  if (error !== null || data === null) {
    return null;
  }
  const role = data.role;
  if (role !== 'super_admin' && role !== 'mentor' && role !== 'viewer') {
    return null;
  }
  return { displayName: String(data.name), role };
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
  const rp = relyingParty();
  const step = subPath(req);

  const retryAfter = await ipLimited(db, ip);
  if (retryAfter !== null) {
    return errorResponse(req, 429, 'too_many_attempts', { 'Retry-After': String(retryAfter) });
  }

  if (step === 'options') {
    const options = await generateAuthenticationOptions({
      rpID: rp.rpID,
      userVerification: 'required',
      // Empty allowCredentials: discoverable passkeys — the device offers the
      // resident credential; no identifier is typed or leaked beforehand.
      allowCredentials: [],
    });
    const stored = await storeChallenge(db, options.challenge, 'authentication', null);
    if (!stored) {
      return errorResponse(req, 500, 'internal_error');
    }
    return jsonResponse(req, 200, { options });
  }

  if (step === 'verify') {
    const body = await parseJsonBody(req, 50_000);
    if (
      typeof body !== 'object' ||
      body === null ||
      !('challenge' in body) ||
      typeof body.challenge !== 'string' ||
      !('response' in body) ||
      !isAuthenticationResponse(body.response)
    ) {
      return errorResponse(req, 400, 'invalid_request');
    }

    const challenge = await consumeChallenge(db, body.challenge, 'authentication');
    if (challenge === null) {
      return errorResponse(req, 401, 'invalid_challenge');
    }

    const credential = await findCredentialById(db, body.response.id);
    if (credential === null) {
      await writeAudit(db, {
        actorType: 'system',
        actorId: null,
        actorRole: null,
        action: 'login',
        entityType: 'webauthn_credential',
        entityId: null,
        outcome: 'denied',
        ip,
        metadata: { reason: 'unknown_credential' },
      });
      return errorResponse(req, 401, 'invalid_credentials');
    }

    const publicKeyBytes = Uint8Array.from(
      atob(credential.publicKey.replaceAll('-', '+').replaceAll('_', '/')),
      (c) => c.charCodeAt(0),
    );

    let verified = false;
    let newCounter = credential.counter;
    try {
      const result = await verifyAuthenticationResponse({
        response: body.response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: rp.expectedOrigin,
        expectedRPID: rp.rpID,
        credential: {
          id: credential.credentialId,
          publicKey: publicKeyBytes,
          counter: credential.counter,
          transports: toTransports(credential.transports),
        },
        requireUserVerification: true,
      });
      verified = result.verified;
      newCounter = result.authenticationInfo.newCounter;
    } catch {
      // Malformed/forged assertion — denied below, with an operational trace.
      serverLog.warn('webauthn.login_verify_rejected', {});
    }

    // Counter regression = possible cloned authenticator. Refuse even a
    // cryptographically valid assertion.
    const counterRegressed = verified && newCounter <= credential.counter && newCounter !== 0;

    if (!verified || counterRegressed) {
      await writeAudit(db, {
        actorType: credential.subjectType,
        actorId: credential.subjectId,
        actorRole: credential.subjectType === 'student' ? 'student' : null,
        action: 'login',
        entityType: credential.subjectType === 'student' ? 'student' : 'admin_user',
        entityId: credential.subjectId,
        outcome: 'denied',
        ip,
        metadata: { reason: counterRegressed ? 'counter_regression' : 'assertion_failed' },
      });
      return errorResponse(req, 401, 'invalid_credentials');
    }

    const details = await loadSubject(db, credential.subjectType, credential.subjectId);
    if (details === null) {
      // Inactive account / pending consent / lookup failure: same generic
      // deny as PIN login (no state oracle through the passkey path).
      await writeAudit(db, {
        actorType: credential.subjectType,
        actorId: credential.subjectId,
        actorRole: credential.subjectType === 'student' ? 'student' : null,
        action: 'login',
        entityType: credential.subjectType === 'student' ? 'student' : 'admin_user',
        entityId: credential.subjectId,
        outcome: 'denied',
        ip,
        metadata: { reason: 'account_gate' },
      });
      return errorResponse(req, 403, 'account_unavailable');
    }

    const { error: touchError } = await db
      .from('webauthn_credentials')
      .update({ counter: newCounter, last_used_at: new Date().toISOString() })
      .eq('id', credential.rowId);
    if (touchError !== null) {
      serverLog.warn('webauthn.counter_update_failed', {});
    }

    const session = await mintSession(
      db,
      credential.subjectType,
      credential.subjectId,
      ip,
      req.headers.get('user-agent'),
    );
    if (session === null) {
      return errorResponse(req, 500, 'internal_error');
    }

    await writeAudit(db, {
      actorType: credential.subjectType,
      actorId: credential.subjectId,
      actorRole: details.role,
      action: 'login',
      entityType: credential.subjectType === 'student' ? 'student' : 'admin_user',
      entityId: credential.subjectId,
      outcome: 'allowed',
      ip,
      metadata: { method: 'webauthn' },
    });

    return jsonResponse(req, 200, {
      token: session.token,
      expiresAt: session.expiresAt,
      webauthnRegistered: true,
      subject: {
        type: credential.subjectType,
        id: credential.subjectId,
        displayName: details.displayName,
        role: details.role,
      },
    });
  }

  return errorResponse(req, 404, 'not_found');
});
