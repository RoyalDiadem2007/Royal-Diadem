/**
 * auth-webauthn-register — passkey enrollment for a signed-in user.
 *
 *   POST /options — generate registration options (requires a valid session)
 *   POST /verify  — verify the authenticator's response and store the
 *                   credential's public key
 *
 * Session-gated on both steps: enrolling a passkey is only possible right
 * after proving identity with the PIN (Spec §5). The device's biometric
 * secret never reaches us — only the public key.
 */
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type RegistrationResponseJSON,
} from 'npm:@simplewebauthn/server@13';
import { createServiceClient } from '../_shared/db.ts';
import { bearerToken, clientIp, errorResponse, handlePreflight, jsonResponse } from '../_shared/http.ts';
import { verifySession } from '../_shared/sessions.ts';
import { writeAudit } from '../_shared/audit.ts';
import { parseJsonBody } from '../_shared/validate.ts';
import { consumeChallenge, relyingParty, storeChallenge, toTransports } from '../_shared/webauthn.ts';
import { serverLog } from '../_shared/logger.ts';

function subPath(req: Request): string {
  const segments = new URL(req.url).pathname.split('/').filter((s) => s !== '');
  return segments[segments.length - 1] ?? '';
}

function isRegistrationResponse(body: unknown): body is RegistrationResponseJSON {
  return (
    typeof body === 'object' &&
    body !== null &&
    'id' in body &&
    typeof body.id === 'string' &&
    'response' in body &&
    typeof body.response === 'object'
  );
}

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
  const subject = await verifySession(db, token);
  if (subject === null) {
    return errorResponse(req, 401, 'invalid_session');
  }

  const rp = relyingParty();
  const step = subPath(req);

  if (step === 'options') {
    const { data: existing } = await db
      .from('webauthn_credentials')
      .select('credential_id, transports')
      .eq('subject_type', subject.subjectType)
      .eq('subject_id', subject.subjectId);

    const options = await generateRegistrationOptions({
      rpName: rp.rpName,
      rpID: rp.rpID,
      userID: new TextEncoder().encode(subject.subjectId),
      userName: subject.subjectId,
      attestationType: 'none',
      excludeCredentials: (existing ?? []).map((row) => ({
        id: String(row.credential_id),
        transports: toTransports(row.transports),
      })),
      authenticatorSelection: {
        residentKey: 'required', // discoverable passkey → usernameless login
        userVerification: 'required', // Face ID / Touch ID / device PIN
      },
    });

    const stored = await storeChallenge(db, options.challenge, 'registration', {
      type: subject.subjectType,
      id: subject.subjectId,
    });
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
      !isRegistrationResponse(body.response)
    ) {
      return errorResponse(req, 400, 'invalid_request');
    }

    const challenge = await consumeChallenge(db, body.challenge, 'registration');
    if (
      challenge === null ||
      challenge.subjectType !== subject.subjectType ||
      challenge.subjectId !== subject.subjectId
    ) {
      return errorResponse(req, 401, 'invalid_challenge');
    }

    let verified = false;
    let credential: { id: string; publicKey: string; counter: number } | null = null;
    let deviceType: string | null = null;
    let backedUp = false;
    let transports: string[] | null = null;
    try {
      const result = await verifyRegistrationResponse({
        response: body.response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: rp.expectedOrigin,
        expectedRPID: rp.rpID,
        requireUserVerification: true,
      });
      verified = result.verified;
      if (result.verified && result.registrationInfo !== undefined) {
        const info = result.registrationInfo;
        credential = {
          id: info.credential.id,
          publicKey: btoa(String.fromCharCode(...info.credential.publicKey))
            .replaceAll('+', '-')
            .replaceAll('/', '_')
            .replaceAll('=', ''),
          counter: info.credential.counter,
        };
        deviceType = info.credentialDeviceType;
        backedUp = info.credentialBackedUp;
        transports = body.response.response.transports?.map(String) ?? null;
      }
    } catch {
      // Verification threw = malformed/forged attestation. Deny below.
      serverLog.warn('webauthn.register_verify_rejected', {});
    }

    if (!verified || credential === null) {
      await writeAudit(db, {
        actorType: subject.subjectType,
        actorId: subject.subjectId,
        actorRole: subject.subjectType === 'student' ? 'student' : null,
        action: 'create',
        entityType: 'webauthn_credential',
        entityId: null,
        outcome: 'denied',
        ip: clientIp(req),
        metadata: { reason: 'verification_failed' },
      });
      return errorResponse(req, 400, 'registration_failed');
    }

    const { data: inserted, error } = await db
      .from('webauthn_credentials')
      .insert({
        subject_type: subject.subjectType,
        subject_id: subject.subjectId,
        credential_id: credential.id,
        public_key: credential.publicKey,
        counter: credential.counter,
        transports,
        device_type: deviceType,
        backed_up: backedUp,
      })
      .select('id')
      .single();
    if (error !== null) {
      serverLog.error('webauthn.credential_insert_failed', {});
      return errorResponse(req, 500, 'internal_error');
    }

    await writeAudit(db, {
      actorType: subject.subjectType,
      actorId: subject.subjectId,
      actorRole: subject.subjectType === 'student' ? 'student' : null,
      action: 'create',
      entityType: 'webauthn_credential',
      entityId: String(inserted.id),
      outcome: 'allowed',
      ip: clientIp(req),
    });
    return jsonResponse(req, 200, { registered: true });
  }

  return errorResponse(req, 404, 'not_found');
});
