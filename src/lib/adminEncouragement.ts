/**
 * Client for the encouragement Edge Function (Phase 7). Everything here is
 * the ADMIN side of the OD-18 gateway — students only ever see rows the anon
 * policy exposes (status = posted), through Phase 8's daily display.
 */
import { callEdgeFunction, type ApiResult } from '@/lib/api';

export type EncouragementStatus = 'draft' | 'approved' | 'posted' | 'rejected';

export type EncouragementMessage = {
  id: string;
  text: string;
  source: 'ai_generated' | 'admin_written';
  scheduledDate: string;
  weekOf: string;
  status: EncouragementStatus;
  model: string | null;
};

export type AiRule = { id: string; text: string; active: boolean };

function asRecord(raw: unknown, what: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${what} is not an object`);
  }
  return raw as Record<string, unknown>;
}

function parseMessage(raw: unknown): EncouragementMessage {
  const r = asRecord(raw, 'message');
  if (
    typeof r.id !== 'string' ||
    typeof r.text !== 'string' ||
    (r.source !== 'ai_generated' && r.source !== 'admin_written') ||
    typeof r.scheduledDate !== 'string' ||
    typeof r.weekOf !== 'string' ||
    (r.status !== 'draft' &&
      r.status !== 'approved' &&
      r.status !== 'posted' &&
      r.status !== 'rejected') ||
    (r.model !== null && typeof r.model !== 'string')
  ) {
    throw new Error('message is malformed');
  }
  return {
    id: r.id,
    text: r.text,
    source: r.source,
    scheduledDate: r.scheduledDate,
    weekOf: r.weekOf,
    status: r.status,
    model: r.model,
  };
}

function parseMessages(raw: unknown): EncouragementMessage[] {
  const record = asRecord(raw, 'messages response');
  if (!Array.isArray(record.messages)) {
    throw new Error('messages response is malformed');
  }
  return record.messages.map(parseMessage);
}

function parseRules(raw: unknown): AiRule[] {
  const record = asRecord(raw, 'rules response');
  if (!Array.isArray(record.rules)) {
    throw new Error('rules response is malformed');
  }
  return record.rules.map((entry) => {
    const r = asRecord(entry, 'rule');
    if (typeof r.id !== 'string' || typeof r.text !== 'string' || typeof r.active !== 'boolean') {
      throw new Error('rule is malformed');
    }
    return { id: r.id, text: r.text, active: r.active };
  });
}

export async function listWeek(
  sessionToken: string,
  weekOf: string,
): Promise<ApiResult<EncouragementMessage[]>> {
  return callEdgeFunction(`encouragement?weekOf=${weekOf}`, {
    method: 'GET',
    sessionToken,
    parse: parseMessages,
  });
}

export async function generateWeek(
  sessionToken: string,
  weekOf: string,
): Promise<ApiResult<EncouragementMessage[]>> {
  return callEdgeFunction('encouragement/generate', {
    method: 'POST',
    sessionToken,
    body: { weekOf },
    parse: parseMessages,
  });
}

export async function approveMessage(
  sessionToken: string,
  messageId: string,
): Promise<ApiResult<null>> {
  return callEdgeFunction('encouragement/approve', {
    method: 'POST',
    sessionToken,
    body: { messageId },
    parse: () => null,
  });
}

export async function rejectMessage(
  sessionToken: string,
  messageId: string,
  reason: string,
): Promise<ApiResult<null>> {
  return callEdgeFunction('encouragement/reject', {
    method: 'POST',
    sessionToken,
    body: { messageId, reason },
    parse: () => null,
  });
}

export async function replaceMessage(
  sessionToken: string,
  messageId: string,
  text: string,
  reason: string,
): Promise<ApiResult<EncouragementMessage>> {
  return callEdgeFunction('encouragement/replace', {
    method: 'POST',
    sessionToken,
    body: { messageId, text, reason },
    parse: (raw) => parseMessage(asRecord(raw, 'replace response').message),
  });
}

export async function postWeek(sessionToken: string, weekOf: string): Promise<ApiResult<number>> {
  return callEdgeFunction('encouragement/post', {
    method: 'POST',
    sessionToken,
    body: { weekOf },
    parse: (raw) => {
      const record = asRecord(raw, 'post response');
      if (typeof record.posted !== 'number') {
        throw new Error('post response is malformed');
      }
      return record.posted;
    },
  });
}

export async function listAiRules(sessionToken: string): Promise<ApiResult<AiRule[]>> {
  return callEdgeFunction('encouragement/rules', {
    method: 'GET',
    sessionToken,
    parse: parseRules,
  });
}

export async function createAiRule(sessionToken: string, text: string): Promise<ApiResult<null>> {
  return callEdgeFunction('encouragement/rules', {
    method: 'POST',
    sessionToken,
    body: { text },
    parse: () => null,
  });
}

export async function toggleAiRule(
  sessionToken: string,
  ruleId: string,
  active: boolean,
): Promise<ApiResult<null>> {
  return callEdgeFunction('encouragement/rules/toggle', {
    method: 'POST',
    sessionToken,
    body: { ruleId, active },
    parse: () => null,
  });
}

/** Monday of the week containing `date` (UTC math on a date-only value). */
export function mondayOf(date: Date): string {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay();
  utc.setUTCDate(utc.getUTCDate() - ((day + 6) % 7));
  return utc.toISOString().slice(0, 10);
}

export function shiftWeek(weekOf: string, weeks: number): string {
  const base = new Date(`${weekOf}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + weeks * 7);
  return base.toISOString().slice(0, 10);
}
