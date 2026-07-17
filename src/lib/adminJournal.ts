/**
 * Client for the admin-journal Edge Function (Phase 6): review roster,
 * per-student decrypted entries, prompt management. super_admin until OD-6.
 */
import { callEdgeFunction, type ApiResult } from '@/lib/api';

export type JournalRosterEntry = {
  studentId: string;
  displayName: string;
  firstName: string;
  lastName: string;
  entryCount: number;
  lastEntryAt: string | null;
  needsReview: boolean;
};

export type JournalRoster = {
  students: JournalRosterEntry[];
  page: number;
  pageSize: number;
  total: number;
};

export type AdminJournalEntry = {
  id: string;
  promptText: string | null;
  text: string;
  aiFlagTriggered: boolean;
  aiFlagReason: string | null;
  createdAt: string;
};

export type AdminJournalDetail = {
  student: { studentId: string; displayName: string };
  entries: AdminJournalEntry[];
};

export type AdminPrompt = { id: string; text: string; active: boolean };

function asRecord(raw: unknown, what: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${what} is not an object`);
  }
  return raw as Record<string, unknown>;
}

function parseRoster(raw: unknown): JournalRoster {
  const record = asRecord(raw, 'journal roster');
  if (
    !Array.isArray(record.students) ||
    typeof record.page !== 'number' ||
    typeof record.pageSize !== 'number' ||
    typeof record.total !== 'number'
  ) {
    throw new Error('journal roster is malformed');
  }
  return {
    students: record.students.map((entry) => {
      const r = asRecord(entry, 'roster row');
      if (
        typeof r.studentId !== 'string' ||
        typeof r.displayName !== 'string' ||
        typeof r.firstName !== 'string' ||
        typeof r.lastName !== 'string' ||
        typeof r.entryCount !== 'number' ||
        typeof r.needsReview !== 'boolean' ||
        (r.lastEntryAt !== null && typeof r.lastEntryAt !== 'string')
      ) {
        throw new Error('roster row is malformed');
      }
      return {
        studentId: r.studentId,
        displayName: r.displayName,
        firstName: r.firstName,
        lastName: r.lastName,
        entryCount: r.entryCount,
        lastEntryAt: r.lastEntryAt,
        needsReview: r.needsReview,
      };
    }),
    page: record.page,
    pageSize: record.pageSize,
    total: record.total,
  };
}

function parseDetail(raw: unknown): AdminJournalDetail {
  const record = asRecord(raw, 'journal detail');
  const student = asRecord(record.student, 'student');
  if (
    typeof student.studentId !== 'string' ||
    typeof student.displayName !== 'string' ||
    !Array.isArray(record.entries)
  ) {
    throw new Error('journal detail is malformed');
  }
  return {
    student: { studentId: student.studentId, displayName: student.displayName },
    entries: record.entries.map((entry) => {
      const r = asRecord(entry, 'journal entry');
      if (
        typeof r.id !== 'string' ||
        typeof r.text !== 'string' ||
        typeof r.createdAt !== 'string' ||
        typeof r.aiFlagTriggered !== 'boolean' ||
        (r.promptText !== null && typeof r.promptText !== 'string') ||
        (r.aiFlagReason !== null && typeof r.aiFlagReason !== 'string')
      ) {
        throw new Error('journal entry is malformed');
      }
      return {
        id: r.id,
        promptText: r.promptText,
        text: r.text,
        aiFlagTriggered: r.aiFlagTriggered,
        aiFlagReason: r.aiFlagReason,
        createdAt: r.createdAt,
      };
    }),
  };
}

function parsePrompts(raw: unknown): AdminPrompt[] {
  const record = asRecord(raw, 'prompts response');
  if (!Array.isArray(record.prompts)) {
    throw new Error('prompts response is malformed');
  }
  return record.prompts.map((entry) => {
    const r = asRecord(entry, 'prompt');
    if (typeof r.id !== 'string' || typeof r.text !== 'string' || typeof r.active !== 'boolean') {
      throw new Error('prompt is malformed');
    }
    return { id: r.id, text: r.text, active: r.active };
  });
}

export async function listJournalRoster(
  sessionToken: string,
  page: number,
): Promise<ApiResult<JournalRoster>> {
  return callEdgeFunction(`admin-journal?page=${String(page)}`, {
    method: 'GET',
    sessionToken,
    parse: parseRoster,
  });
}

export async function fetchJournalDetail(
  sessionToken: string,
  studentId: string,
): Promise<ApiResult<AdminJournalDetail>> {
  return callEdgeFunction(`admin-journal/student?studentId=${studentId}`, {
    method: 'GET',
    sessionToken,
    parse: parseDetail,
  });
}

export async function listPrompts(sessionToken: string): Promise<ApiResult<AdminPrompt[]>> {
  return callEdgeFunction('admin-journal/prompts', {
    method: 'GET',
    sessionToken,
    parse: parsePrompts,
  });
}

export async function createPrompt(
  sessionToken: string,
  text: string,
): Promise<ApiResult<{ id: string }>> {
  return callEdgeFunction('admin-journal/prompts', {
    method: 'POST',
    sessionToken,
    body: { text },
    parse: (raw) => {
      const record = asRecord(raw, 'create response');
      const prompt = asRecord(record.prompt, 'prompt');
      if (typeof prompt.id !== 'string') {
        throw new Error('create response is malformed');
      }
      return { id: prompt.id };
    },
  });
}

export async function togglePrompt(
  sessionToken: string,
  promptId: string,
  active: boolean,
): Promise<ApiResult<null>> {
  return callEdgeFunction('admin-journal/prompts/toggle', {
    method: 'POST',
    sessionToken,
    body: { promptId, active },
    parse: () => null,
  });
}
