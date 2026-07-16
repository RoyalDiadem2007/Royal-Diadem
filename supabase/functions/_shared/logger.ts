/**
 * Server-side operational logger for Edge Functions — the ONLY module allowed
 * to touch console (CLAUDE.md §3: central logger only; Supabase captures
 * console output as function logs). Everything else imports from here.
 *
 * Same redaction contract as the client audit logger: PHI/PII-shaped keys are
 * stripped before anything is written. Log ids, never contents (§6).
 */

export type ServerLogFields = Readonly<Record<string, string | number | boolean | null>>;

const REDACTED_KEY_PATTERN =
  /name|dob|birth|age|pin|password|passcode|credential|token|secret|key|note|text|body|content|message_|journal|email|phone|address|photo|school|guardian|consent/i;

const REDACTED = '[REDACTED]';

function redact(fields: ServerLogFields): ServerLogFields {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(fields)) {
    safe[k] = REDACTED_KEY_PATTERN.test(k) ? REDACTED : v;
  }
  return safe;
}

function write(level: 'info' | 'warn' | 'error', event: string, fields: ServerLogFields): void {
  const line = JSON.stringify({ level, event, ...redact(fields) });
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.info(line);
  }
}

export const serverLog = {
  info(event: string, fields: ServerLogFields = {}): void {
    write('info', event, fields);
  },
  warn(event: string, fields: ServerLogFields = {}): void {
    write('warn', event, fields);
  },
  error(event: string, fields: ServerLogFields = {}): void {
    write('error', event, fields);
  },
} as const;
