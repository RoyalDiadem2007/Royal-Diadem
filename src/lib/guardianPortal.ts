/**
 * Client for the guardian-portal Edge Function (OD-19 build B). The consent
 * code never flows through here — it appears only in the student's app; the
 * guardian types what she shares with them.
 */
import { callEdgeFunction, type ApiResult } from '@/lib/api';

export type GuardianAccessState = 'none' | 'pending' | 'active';

export type GuardianStudent = {
  studentId: string;
  displayName: string;
  state: GuardianAccessState;
  accessExpiresAt: string | null;
};

export type GuardianStudentView = {
  student: {
    studentId: string;
    displayName: string;
    firstName: string;
    lastName: string;
    status: string;
    phase: string | null;
    enrollmentDate: string;
  };
  /** Newest-first; scores and emojis only — never note text (v1 boundary). */
  trend: { checkDate: string; moodScore: number; moodEmoji: string }[];
  accessExpiresAt: string | null;
};

function asRecord(raw: unknown, what: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${what} is not an object`);
  }
  return raw as Record<string, unknown>;
}

function parseState(value: unknown): GuardianAccessState {
  if (value !== 'none' && value !== 'pending' && value !== 'active') {
    throw new Error('access state is malformed');
  }
  return value;
}

function optionalIso(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error('timestamp is malformed');
  }
  return value;
}

function parseStudents(raw: unknown): GuardianStudent[] {
  const record = asRecord(raw, 'portal response');
  if (!Array.isArray(record.students)) {
    throw new Error('portal response is malformed');
  }
  return record.students.map((entry) => {
    const e = asRecord(entry, 'portal student');
    if (typeof e.studentId !== 'string' || typeof e.displayName !== 'string') {
      throw new Error('portal student is malformed');
    }
    return {
      studentId: e.studentId,
      displayName: e.displayName,
      state: parseState(e.state),
      accessExpiresAt: optionalIso(e.accessExpiresAt),
    };
  });
}

function parseStateChange(raw: unknown): {
  state: GuardianAccessState;
  accessExpiresAt: string | null;
} {
  const record = asRecord(raw, 'state response');
  return { state: parseState(record.state), accessExpiresAt: optionalIso(record.accessExpiresAt) };
}

function parseStudentView(raw: unknown): GuardianStudentView {
  const record = asRecord(raw, 'student view');
  const s = asRecord(record.student, 'student');
  if (!Array.isArray(record.trend)) {
    throw new Error('student view is malformed');
  }
  if (
    typeof s.studentId !== 'string' ||
    typeof s.displayName !== 'string' ||
    typeof s.firstName !== 'string' ||
    typeof s.lastName !== 'string' ||
    typeof s.status !== 'string' ||
    typeof s.enrollmentDate !== 'string' ||
    (s.phase !== null && typeof s.phase !== 'string')
  ) {
    throw new Error('student view is malformed');
  }
  return {
    student: {
      studentId: s.studentId,
      displayName: s.displayName,
      firstName: s.firstName,
      lastName: s.lastName,
      status: s.status,
      phase: s.phase,
      enrollmentDate: s.enrollmentDate,
    },
    trend: record.trend.map((point) => {
      const p = asRecord(point, 'trend point');
      if (
        typeof p.checkDate !== 'string' ||
        typeof p.moodScore !== 'number' ||
        typeof p.moodEmoji !== 'string'
      ) {
        throw new Error('trend point is malformed');
      }
      return { checkDate: p.checkDate, moodScore: p.moodScore, moodEmoji: p.moodEmoji };
    }),
    accessExpiresAt: optionalIso(record.accessExpiresAt),
  };
}

export async function listLinkedStudents(
  sessionToken: string,
): Promise<ApiResult<GuardianStudent[]>> {
  return callEdgeFunction('guardian-portal', {
    method: 'GET',
    sessionToken,
    parse: parseStudents,
  });
}

export async function requestAccess(sessionToken: string, studentId: string) {
  return callEdgeFunction('guardian-portal/request-access', {
    method: 'POST',
    sessionToken,
    body: { studentId },
    parse: parseStateChange,
  });
}

export async function enterConsentCode(sessionToken: string, studentId: string, code: string) {
  return callEdgeFunction('guardian-portal/enter-code', {
    method: 'POST',
    sessionToken,
    body: { studentId, code },
    parse: parseStateChange,
  });
}

export async function fetchStudentView(
  sessionToken: string,
  studentId: string,
): Promise<ApiResult<GuardianStudentView>> {
  return callEdgeFunction(`guardian-portal/student?studentId=${studentId}`, {
    method: 'GET',
    sessionToken,
    parse: parseStudentView,
  });
}
