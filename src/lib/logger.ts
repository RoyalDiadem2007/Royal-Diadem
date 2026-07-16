/**
 * Central audit logger — the ONLY sanctioned logging pathway (CLAUDE.md §3).
 * `console.*` is banned everywhere (ESLint `no-console` + the commit guard).
 *
 * Safety model:
 * - Field values whose keys look like PHI/PII are redacted before the event is
 *   ever stored, so minors' data cannot leak through diagnostics (CLAUDE.md §6:
 *   log ids, never contents).
 * - Events buffer in memory (bounded, drop-oldest) until a server transport is
 *   registered. The transport — an Edge Function writing to the append-only
 *   `audit_logs` table — attaches once the auth session layer exists (Phase 2).
 * - Nothing is ever written to client storage (§3: no PHI in localStorage etc.).
 */

export type LogLevel = 'info' | 'warn' | 'error';

export type LogFields = Readonly<Record<string, string | number | boolean | null>>;

export type LogEvent = {
  level: LogLevel;
  /** Machine-readable event name, e.g. "ui.error_boundary". */
  event: string;
  fields: LogFields;
  /** UTC ISO-8601. */
  timestamp: string;
};

export type LogTransport = (events: readonly LogEvent[]) => Promise<void>;

/**
 * Keys whose values are never loggable: student identity, credentials, and
 * free-text content are PHI-equivalent regulated data (CLAUDE.md §17.1).
 */
const REDACTED_KEY_PATTERN =
  /name|dob|birth|age|pin|password|passcode|credential|token|secret|key|note|text|body|content|message_|journal|email|phone|address|photo|school|guardian|consent/i;

const REDACTED = '[REDACTED]';
const MAX_BUFFERED_EVENTS = 200;
const MAX_STRING_FIELD_LENGTH = 500;

const buffer: LogEvent[] = [];
let transport: LogTransport | null = null;
let flushInFlight = false;

function redactFields(fields: LogFields): LogFields {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (REDACTED_KEY_PATTERN.test(key)) {
      safe[key] = REDACTED;
    } else if (typeof value === 'string' && value.length > MAX_STRING_FIELD_LENGTH) {
      safe[key] = value.slice(0, MAX_STRING_FIELD_LENGTH);
    } else {
      safe[key] = value;
    }
  }
  return safe;
}

function emit(level: LogLevel, event: string, fields: LogFields = {}): void {
  buffer.push({
    level,
    event,
    fields: redactFields(fields),
    timestamp: new Date().toISOString(),
  });
  if (buffer.length > MAX_BUFFERED_EVENTS) {
    buffer.shift();
  }
  if (transport !== null) {
    void flush();
  }
}

/**
 * Sends every buffered event to the registered transport. On transport failure
 * the batch is re-buffered (recovery, not a silent drop) and retried on the
 * next emit or explicit flush.
 */
export async function flush(): Promise<void> {
  if (transport === null || flushInFlight || buffer.length === 0) {
    return;
  }
  flushInFlight = true;
  const batch = buffer.splice(0, buffer.length);
  try {
    await transport(batch);
  } catch {
    // Recovery: keep the events for the next attempt, bounded so a dead
    // transport can never grow memory without limit.
    buffer.unshift(...batch.slice(-MAX_BUFFERED_EVENTS));
    buffer.splice(0, Math.max(0, buffer.length - MAX_BUFFERED_EVENTS));
  } finally {
    flushInFlight = false;
  }
}

/** Attaches the server transport and immediately flushes anything buffered. */
export function registerTransport(next: LogTransport): void {
  transport = next;
  void flush();
}

/** Removes the transport (e.g. on logout); subsequent events buffer again. */
export function unregisterTransport(): void {
  transport = null;
}

export const logger = {
  info(event: string, fields?: LogFields): void {
    emit('info', event, fields);
  },
  warn(event: string, fields?: LogFields): void {
    emit('warn', event, fields);
  },
  error(event: string, fields?: LogFields): void {
    emit('error', event, fields);
  },
} as const;
