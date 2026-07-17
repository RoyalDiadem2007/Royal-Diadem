/**
 * Transactional email transport (OD-19). Production sends through Resend's
 * HTTPS API; the local stack sets EMAIL_TRANSPORT=log so E2E runs exercise
 * the full issuance path without external network (same pattern as
 * Turnstile's official test keys). Unconfigured production → callers fail
 * closed with a clear code, never a silent no-send.
 *
 * PII discipline: recipient addresses and names go to the provider (that is
 * its job — Resend is on the §17.5 vendor list) but never into logs here.
 */
import { serverLog } from './logger.ts';

const RESEND_API_URL = 'https://api.resend.com/emails';
// Resend's onboarding sender — delivers only to the account owner's inbox.
// Real launch sets EMAIL_FROM after domain verification (KEYS_SETUP §3b R2).
const DEFAULT_FROM = 'Royal Diadem <onboarding@resend.dev>';

export type OutboundEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export function emailConfigured(): boolean {
  if (Deno.env.get('EMAIL_TRANSPORT') === 'log') {
    return true;
  }
  const key = Deno.env.get('RESEND_API_KEY');
  return key !== undefined && key.trim() !== '';
}

/** True on accepted delivery. Failures are logged (no recipient) and false. */
export async function sendEmail(message: OutboundEmail): Promise<boolean> {
  if (Deno.env.get('EMAIL_TRANSPORT') === 'log') {
    serverLog.info('email.log_transport_send', { subjectLength: message.subject.length });
    return true;
  }

  const key = Deno.env.get('RESEND_API_KEY');
  if (key === undefined || key.trim() === '') {
    serverLog.error('email.not_configured', {});
    return false;
  }

  let response: Response;
  try {
    response = await fetch(Deno.env.get('EMAIL_API_URL') ?? RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: Deno.env.get('EMAIL_FROM') ?? DEFAULT_FROM,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });
  } catch {
    serverLog.error('email.send_network_failed', {});
    return false;
  }
  if (!response.ok) {
    serverLog.error('email.send_rejected', { httpStatus: response.status });
    return false;
  }
  return true;
}
