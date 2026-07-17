/**
 * Client for the crown-check Edge Function (Phase 5, Spec §6.2). The server
 * never returns flag state to students — this wire shape has no flag fields
 * by design, so nothing here could surface one.
 */
import { callEdgeFunction, type ApiResult } from '@/lib/api';

export type CrownCheckEntry = {
  id: string;
  checkDate: string;
  moodScore: number;
  moodEmoji: string;
  note: string | null;
};

export type CrownCheckStatus = {
  today: CrownCheckEntry | null;
  recent: CrownCheckEntry[];
};

export type SubmitCrownCheckInput = {
  moodScore: number;
  moodEmoji: string;
  note?: string;
};

function parseEntry(raw: unknown): CrownCheckEntry {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('crown check entry is not an object');
  }
  const record = raw as Record<string, unknown>;
  if (
    typeof record.id !== 'string' ||
    typeof record.checkDate !== 'string' ||
    typeof record.moodScore !== 'number' ||
    typeof record.moodEmoji !== 'string' ||
    (record.note !== null && typeof record.note !== 'string')
  ) {
    throw new Error('crown check entry is malformed');
  }
  return {
    id: record.id,
    checkDate: record.checkDate,
    moodScore: record.moodScore,
    moodEmoji: record.moodEmoji,
    note: record.note,
  };
}

function parseStatus(raw: unknown): CrownCheckStatus {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('crown check status is not an object');
  }
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.recent)) {
    throw new Error('crown check status is malformed');
  }
  return {
    today: record.today === null || record.today === undefined ? null : parseEntry(record.today),
    recent: record.recent.map(parseEntry),
  };
}

function parseSubmitted(raw: unknown): CrownCheckEntry {
  if (typeof raw !== 'object' || raw === null || !('check' in raw)) {
    throw new Error('crown check response is malformed');
  }
  return parseEntry(raw.check);
}

export async function fetchCrownCheckStatus(
  sessionToken: string,
): Promise<ApiResult<CrownCheckStatus>> {
  return callEdgeFunction('crown-check', {
    method: 'GET',
    sessionToken,
    parse: parseStatus,
  });
}

export async function submitCrownCheck(
  sessionToken: string,
  input: SubmitCrownCheckInput,
): Promise<ApiResult<CrownCheckEntry>> {
  return callEdgeFunction('crown-check', {
    method: 'POST',
    sessionToken,
    body: input,
    parse: parseSubmitted,
  });
}
