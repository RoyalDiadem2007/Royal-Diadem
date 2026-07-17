/**
 * Client for the admin-crown-checks Edge Function (Phase 5 trend views).
 * Roster rows carry scores only; notes appear solely in the per-student
 * detail, mirroring what the server sends.
 */
import { callEdgeFunction, type ApiResult } from '@/lib/api';

export type TrendPoint = {
  checkDate: string;
  moodScore: number;
};

export type RosterEntry = {
  studentId: string;
  displayName: string;
  firstName: string;
  lastName: string;
  lastCheck: { checkDate: string; moodScore: number; moodEmoji: string } | null;
  /** Newest-first points inside the roster window. */
  recent: TrendPoint[];
  needsReview: boolean;
};

export type CrownCheckRoster = {
  students: RosterEntry[];
  page: number;
  pageSize: number;
  total: number;
};

export type StudentCheckDetail = {
  id: string;
  checkDate: string;
  moodScore: number;
  moodEmoji: string;
  note: string | null;
  aiFlagTriggered: boolean;
  aiFlagReason: string | null;
};

export type StudentTrendDetail = {
  student: {
    studentId: string;
    displayName: string;
    firstName: string;
    lastName: string;
    status: string;
    needsReview: boolean;
  };
  checks: StudentCheckDetail[];
};

function asRecord(raw: unknown, what: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${what} is not an object`);
  }
  return raw as Record<string, unknown>;
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value === '') {
    throw new Error(`field "${key}" is malformed`);
  }
  return value;
}

function requireNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`field "${key}" is malformed`);
  }
  return value;
}

function requireBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') {
    throw new Error(`field "${key}" is malformed`);
  }
  return value;
}

function optionalStringOrNull(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`field "${key}" is malformed`);
  }
  return value;
}

function parseTrendPoint(raw: unknown): TrendPoint {
  const record = asRecord(raw, 'trend point');
  return {
    checkDate: requireString(record, 'checkDate'),
    moodScore: requireNumber(record, 'moodScore'),
  };
}

function parseRosterEntry(raw: unknown): RosterEntry {
  const record = asRecord(raw, 'roster entry');
  const lastCheckRaw = record.lastCheck;
  let lastCheck: RosterEntry['lastCheck'] = null;
  if (lastCheckRaw !== null && lastCheckRaw !== undefined) {
    const lastRecord = asRecord(lastCheckRaw, 'last check');
    lastCheck = {
      checkDate: requireString(lastRecord, 'checkDate'),
      moodScore: requireNumber(lastRecord, 'moodScore'),
      moodEmoji: requireString(lastRecord, 'moodEmoji'),
    };
  }
  if (!Array.isArray(record.recent)) {
    throw new Error('roster entry is malformed');
  }
  return {
    studentId: requireString(record, 'studentId'),
    displayName: requireString(record, 'displayName'),
    firstName: requireString(record, 'firstName'),
    lastName: requireString(record, 'lastName'),
    lastCheck,
    recent: record.recent.map(parseTrendPoint),
    needsReview: requireBoolean(record, 'needsReview'),
  };
}

function parseRoster(raw: unknown): CrownCheckRoster {
  const record = asRecord(raw, 'roster response');
  if (
    !Array.isArray(record.students) ||
    typeof record.page !== 'number' ||
    typeof record.pageSize !== 'number' ||
    typeof record.total !== 'number'
  ) {
    throw new Error('roster response is malformed');
  }
  return {
    students: record.students.map(parseRosterEntry),
    page: record.page,
    pageSize: record.pageSize,
    total: record.total,
  };
}

function parseCheckDetail(raw: unknown): StudentCheckDetail {
  const record = asRecord(raw, 'check detail');
  return {
    id: requireString(record, 'id'),
    checkDate: requireString(record, 'checkDate'),
    moodScore: requireNumber(record, 'moodScore'),
    moodEmoji: requireString(record, 'moodEmoji'),
    note: optionalStringOrNull(record, 'note'),
    aiFlagTriggered: requireBoolean(record, 'aiFlagTriggered'),
    aiFlagReason: optionalStringOrNull(record, 'aiFlagReason'),
  };
}

function parseStudentDetail(raw: unknown): StudentTrendDetail {
  const record = asRecord(raw, 'student detail response');
  const studentRecord = asRecord(record.student, 'student');
  if (!Array.isArray(record.checks)) {
    throw new Error('student detail response is malformed');
  }
  return {
    student: {
      studentId: requireString(studentRecord, 'studentId'),
      displayName: requireString(studentRecord, 'displayName'),
      firstName: requireString(studentRecord, 'firstName'),
      lastName: requireString(studentRecord, 'lastName'),
      status: requireString(studentRecord, 'status'),
      needsReview: requireBoolean(studentRecord, 'needsReview'),
    },
    checks: record.checks.map(parseCheckDetail),
  };
}

export async function listCrownCheckRoster(
  sessionToken: string,
  page: number,
): Promise<ApiResult<CrownCheckRoster>> {
  return callEdgeFunction(`admin-crown-checks?page=${String(page)}`, {
    method: 'GET',
    sessionToken,
    parse: parseRoster,
  });
}

export async function fetchStudentTrend(
  sessionToken: string,
  studentId: string,
): Promise<ApiResult<StudentTrendDetail>> {
  return callEdgeFunction(`admin-crown-checks/student?studentId=${studentId}`, {
    method: 'GET',
    sessionToken,
    parse: parseStudentDetail,
  });
}
