/**
 * Client for the admin-students Edge Function (Phase 4 enrollment + OD-9 PIN
 * reset). The plaintext PIN in create/reset responses exists for the printed
 * card, is shown to the admin once, and is never persisted or logged.
 */
import { callEdgeFunction, type ApiResult } from '@/lib/api';

export type AdminStudent = {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  loginCode: string | null;
  status: string;
  coppaRequired: boolean;
  coppaConsentStatus: string;
  phase: string | null;
  enrollmentDate: string;
};

export type StudentRoster = {
  students: AdminStudent[];
  page: number;
  pageSize: number;
  total: number;
};

export type IssuedCredentials = {
  student: AdminStudent;
  pin: string;
};

export type CreateStudentInput = {
  firstName: string;
  lastName: string;
  displayName: string;
  dateOfBirth: string;
  gradeLevel?: string;
  schoolName?: string;
  phase?: string;
};

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value === '') {
    throw new Error(`student field "${key}" is malformed`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`student field "${key}" is malformed`);
  }
  return value;
}

function parseStudent(raw: unknown): AdminStudent {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('student is not an object');
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.coppaRequired !== 'boolean') {
    throw new Error('student field "coppaRequired" is malformed');
  }
  return {
    id: requireString(record, 'id'),
    firstName: requireString(record, 'firstName'),
    lastName: requireString(record, 'lastName'),
    displayName: requireString(record, 'displayName'),
    loginCode: optionalString(record, 'loginCode'),
    status: requireString(record, 'status'),
    coppaRequired: record.coppaRequired,
    coppaConsentStatus: requireString(record, 'coppaConsentStatus'),
    phase: optionalString(record, 'phase'),
    enrollmentDate: requireString(record, 'enrollmentDate'),
  };
}

function parseRoster(raw: unknown): StudentRoster {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('roster response is not an object');
  }
  const record = raw as Record<string, unknown>;
  if (
    !Array.isArray(record.students) ||
    typeof record.page !== 'number' ||
    typeof record.pageSize !== 'number' ||
    typeof record.total !== 'number'
  ) {
    throw new Error('roster response is malformed');
  }
  return {
    students: record.students.map(parseStudent),
    page: record.page,
    pageSize: record.pageSize,
    total: record.total,
  };
}

function parseIssued(raw: unknown): IssuedCredentials {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('credentials response is not an object');
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.pin !== 'string' || !/^\d{4,8}$/.test(record.pin)) {
    throw new Error('credentials response is malformed');
  }
  return { student: parseStudent(record.student), pin: record.pin };
}

export async function listStudents(
  sessionToken: string,
  page: number,
): Promise<ApiResult<StudentRoster>> {
  return callEdgeFunction(`admin-students?page=${String(page)}`, {
    method: 'GET',
    sessionToken,
    parse: parseRoster,
  });
}

export async function createStudent(
  sessionToken: string,
  input: CreateStudentInput,
): Promise<ApiResult<IssuedCredentials>> {
  return callEdgeFunction('admin-students/create', {
    method: 'POST',
    sessionToken,
    body: input,
    parse: parseIssued,
  });
}

export async function resetStudentPin(
  sessionToken: string,
  studentId: string,
): Promise<ApiResult<IssuedCredentials>> {
  return callEdgeFunction('admin-students/reset-pin', {
    method: 'POST',
    sessionToken,
    body: { studentId },
    parse: parseIssued,
  });
}
