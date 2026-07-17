/**
 * WebAuthn plumbing shared by the register/login ceremony functions:
 * relying-party config from env and the single-use challenge lifecycle.
 *
 * The private key never leaves the student's device; we store only the
 * credential's public key + signature counter (webauthn_credentials).
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { AuthenticatorTransportFuture } from 'npm:@simplewebauthn/server@13';
import { serverLog } from './logger.ts';
import type { SubjectType } from './sessions.ts';

const KNOWN_TRANSPORTS: readonly AuthenticatorTransportFuture[] = [
  'ble',
  'cable',
  'hybrid',
  'internal',
  'nfc',
  'smart-card',
  'usb',
];

/** Narrows a text[] column to the transport union simplewebauthn expects. */
export function toTransports(value: unknown): AuthenticatorTransportFuture[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const known = value.filter(
    (t): t is AuthenticatorTransportFuture =>
      typeof t === 'string' && (KNOWN_TRANSPORTS as readonly string[]).includes(t),
  );
  return known.length > 0 ? known : undefined;
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export type RelyingParty = { rpID: string; rpName: string; expectedOrigin: string };

export function relyingParty(): RelyingParty {
  // Local dev defaults; production sets these via `supabase secrets set`
  // (WEBAUTHN_RP_ID = the app domain, WEBAUTHN_ORIGIN = https://<domain>).
  const rpID = Deno.env.get('WEBAUTHN_RP_ID') ?? 'localhost';
  const rpName = Deno.env.get('WEBAUTHN_RP_NAME') ?? 'Royal Diadem';
  const expectedOrigin = Deno.env.get('WEBAUTHN_ORIGIN') ?? 'http://localhost:5173';
  return { rpID, rpName, expectedOrigin };
}

export async function storeChallenge(
  db: SupabaseClient,
  challenge: string,
  purpose: 'registration' | 'authentication',
  subject: { type: SubjectType; id: string } | null,
): Promise<boolean> {
  const { error } = await db.from('webauthn_challenges').insert({
    challenge,
    purpose,
    subject_type: subject?.type ?? null,
    subject_id: subject?.id ?? null,
    expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
  });
  if (error !== null) {
    serverLog.error('webauthn.challenge_store_failed', {});
    return false;
  }
  return true;
}

export type ConsumedChallenge = {
  challenge: string;
  subjectType: SubjectType | null;
  subjectId: string | null;
};

/**
 * Atomically consumes (deletes) a stored challenge. Single-use: it is removed
 * on the FIRST verify attempt, success or failure, and expired rows are never
 * honored. Returns null when unknown/expired/wrong purpose — fail closed.
 */
export async function consumeChallenge(
  db: SupabaseClient,
  challenge: string,
  purpose: 'registration' | 'authentication',
): Promise<ConsumedChallenge | null> {
  const { data, error } = await db
    .from('webauthn_challenges')
    .delete()
    .eq('challenge', challenge)
    .eq('purpose', purpose)
    .select('challenge, subject_type, subject_id, expires_at')
    .maybeSingle();
  if (error !== null) {
    serverLog.error('webauthn.challenge_consume_failed', {});
    return null;
  }
  if (data === null) {
    return null;
  }
  if (new Date(String(data.expires_at)).getTime() <= Date.now()) {
    return null;
  }
  const subjectType = data.subject_type;
  return {
    challenge: String(data.challenge),
    subjectType: subjectType === 'student' || subjectType === 'admin' ? subjectType : null,
    subjectId: data.subject_id === null ? null : String(data.subject_id),
  };
}

export type StoredCredential = {
  rowId: string;
  /** Passkeys are a student/admin surface — guardians sign in with email+PIN
   * (OD-19), so a guardian-typed credential row can never exist or load. */
  subjectType: 'student' | 'admin';
  subjectId: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[] | null;
};

export async function findCredentialById(
  db: SupabaseClient,
  credentialId: string,
): Promise<StoredCredential | null> {
  const { data, error } = await db
    .from('webauthn_credentials')
    .select('id, subject_type, subject_id, credential_id, public_key, counter, transports')
    .eq('credential_id', credentialId)
    .maybeSingle();
  if (error !== null) {
    serverLog.error('webauthn.credential_lookup_failed', {});
    return null;
  }
  if (data === null) {
    return null;
  }
  const subjectType = data.subject_type;
  if (subjectType !== 'student' && subjectType !== 'admin') {
    return null;
  }
  return {
    rowId: String(data.id),
    subjectType,
    subjectId: String(data.subject_id),
    credentialId: String(data.credential_id),
    publicKey: String(data.public_key),
    counter: Number(data.counter),
    transports: Array.isArray(data.transports) ? data.transports.map(String) : null,
  };
}
