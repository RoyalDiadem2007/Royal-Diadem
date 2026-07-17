/**
 * Magic-link issuance for first-login onboarding (Phase 4c, OD-19).
 *
 * Recipient-by-age rules (age at issuance):
 *   * under 13  → guardian's inbox only (her own email is never collected
 *                 pre-consent), set up together with the student present
 *   * 13+       → the student's own inbox
 *
 * Tokens are 256-bit random, stored as SHA-256 digests, single-use, 72h
 * expiry. Re-issuing revokes every earlier active link for the same student
 * and recipient so exactly one link can ever work at a time.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { generateOpaqueToken, sha256Hex } from './hash.ts';
import { appOrigin } from './http.ts';
import { serverLog } from './logger.ts';
import type { OutboundEmail } from './email.ts';

export const LINK_TTL_HOURS = 72;
export const GUARDIAN_LINK_MAX_AGE = 13;

export type LinkRecipient = 'student' | 'guardian';

/** Who the first-login link must go to for a student of this age (OD-19). */
export function linkRecipientForAge(age: number): LinkRecipient {
  return age < GUARDIAN_LINK_MAX_AGE ? 'guardian' : 'student';
}

/**
 * White-label rule (§4.5): the display name in outbound email is deployment
 * configuration, same pattern as CROWN_CODE_PREFIX.
 */
export function brandName(): string {
  const configured = Deno.env.get('BRAND_NAME')?.trim();
  return configured !== undefined && configured !== '' ? configured : 'Royal Diadem';
}

export type IssuedLink = { token: string; expiresAt: string };

export type LinkPurpose = 'first_login' | 'guardian_portal';

export type IssueInput = {
  studentId: string;
  recipient: LinkRecipient;
  guardianId: string | null;
  createdBy: string;
  purpose?: LinkPurpose;
};

/** Revokes prior active links (same student/recipient/purpose), then issues
 * a fresh one. Null on failure. */
export async function issueMagicLink(
  db: SupabaseClient,
  input: IssueInput,
): Promise<IssuedLink | null> {
  const purpose = input.purpose ?? 'first_login';
  const { error: revokeError } = await db
    .from('magic_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('student_id', input.studentId)
    .eq('recipient', input.recipient)
    .eq('purpose', purpose)
    .is('used_at', null)
    .is('revoked_at', null);
  if (revokeError !== null) {
    serverLog.error('magic_link.revoke_prior_failed', {});
    return null; // fail closed — never leave two live links
  }

  const token = generateOpaqueToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + LINK_TTL_HOURS * 3600 * 1000).toISOString();

  const { error } = await db.from('magic_links').insert({
    student_id: input.studentId,
    recipient: input.recipient,
    guardian_id: input.guardianId,
    token_hash: tokenHash,
    purpose,
    expires_at: expiresAt,
    created_by: input.createdBy,
  });
  if (error !== null) {
    serverLog.error('magic_link.insert_failed', {});
    return null;
  }
  return { token, expiresAt };
}

/** The link lands on the SPA's /welcome route; the token rides the URL
 * fragment so it never appears in server or CDN request logs. */
export function magicLinkUrl(token: string): string {
  return `${appOrigin()}/welcome#t=${token}`;
}

/** First-login email. The link is the only secret — no PIN, no crown code. */
export function buildFirstLoginEmail(to: string, recipient: LinkRecipient): OutboundEmail {
  const name = brandName();
  const url = '__LINK__'; // replaced below so both bodies share one template
  const guardianIntro =
    'You are receiving this because your daughter or mentee is being welcomed into the program. Please open the link together with her — her sign-in code appears once, on that page.';
  const studentIntro =
    'Your crown is waiting, queen. Tap the link below to get your sign-in code — it appears once, so save it somewhere safe.';
  const intro = recipient === 'guardian' ? guardianIntro : studentIntro;
  const text = [
    `Welcome to ${name}!`,
    '',
    intro,
    '',
    url,
    '',
    `This link works once and expires in ${String(LINK_TTL_HOURS)} hours. If it expires, ask ${
      recipient === 'guardian' ? 'the program team' : 'your mentor'
    } to send a new one.`,
  ].join('\n');
  const html = text
    .split('\n')
    .map((line) => (line === url ? `<p><a href="${url}">Open your welcome link</a></p>` : `<p>${line}</p>`))
    .join('');
  return {
    to,
    subject: `Welcome to ${name} — your sign-in link`,
    html,
    text,
  };
}

/** Guardian portal invitation (OD-19 build B). Like the first-login email,
 * the link is the only secret. */
export function buildGuardianPortalEmail(to: string): OutboundEmail {
  const name = brandName();
  const url = '__LINK__';
  const text = [
    `${name} guardian access`,
    '',
    'You have been invited to the guardian portal. Through it you can ask to view your ' +
      "daughter's or mentee's account — each time, she sees your request in her app and " +
      'shares a code with you, so nothing happens without her knowing.',
    '',
    url,
    '',
    `This link works once and expires in ${String(LINK_TTL_HOURS)} hours. It will show your ` +
      'sign-in details exactly once — have somewhere safe ready to save them.',
  ].join('\n');
  const html = text
    .split('\n')
    .map((line) =>
      line === url ? `<p><a href="${url}">Open your guardian invitation</a></p>` : `<p>${line}</p>`,
    )
    .join('');
  return { to, subject: `${name} — your guardian portal invitation`, html, text };
}

/** Substitutes the real link into a built email (kept out of the builder so
 * the raw token stays in exactly one code path). */
export function withLink(message: OutboundEmail, token: string): OutboundEmail {
  const url = magicLinkUrl(token);
  return {
    ...message,
    html: message.html.replaceAll('__LINK__', url),
    text: message.text.replaceAll('__LINK__', url),
  };
}
