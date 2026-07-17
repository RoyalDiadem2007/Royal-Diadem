/**
 * Passkey (WebAuthn) ceremonies from the client side. The browser talks to
 * the device's authenticator (Face ID / Touch ID / device PIN); we relay the
 * public results to the Edge Functions. Biometric data never leaves the
 * device — we only ever see public keys and signed challenges.
 */
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';

export function passkeysSupported(): boolean {
  // Feature-detect: lib.dom types claim PublicKeyCredential always exists,
  // but older WebViews genuinely lack it.
  return typeof window !== 'undefined' && 'PublicKeyCredential' in window;
}

export type RegistrationCeremony = {
  challenge: string;
  response: RegistrationResponseJSON;
};

export type AuthenticationCeremony = {
  challenge: string;
  response: AuthenticationResponseJSON;
};

/** Runs the browser half of registration against server-provided options. */
export async function performRegistration(
  options: PublicKeyCredentialCreationOptionsJSON,
): Promise<RegistrationCeremony> {
  const response = await startRegistration({ optionsJSON: options });
  return { challenge: options.challenge, response };
}

/** Runs the browser half of authentication against server-provided options. */
export async function performAuthentication(
  options: PublicKeyCredentialRequestOptionsJSON,
): Promise<AuthenticationCeremony> {
  const response = await startAuthentication({ optionsJSON: options });
  return { challenge: options.challenge, response };
}
