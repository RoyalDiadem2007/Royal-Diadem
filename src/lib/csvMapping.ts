/**
 * Column mapping for enrollment CSVs. Header names are auto-matched by
 * heuristic (the admin can override every guess in the UI); rows are then
 * validated client-side so broken lines are reported by CSV line number
 * before anything is uploaded. Server-side validation still re-checks all of
 * it at the trust boundary.
 */
import { toIsoDate } from '@/lib/csv';
import type { CreateStudentInput } from '@/lib/adminStudents';

export const STUDENT_FIELDS = [
  'firstName',
  'lastName',
  'displayName',
  'dateOfBirth',
  'gradeLevel',
  'schoolName',
  'phase',
  'studentEmail',
  'guardianName',
  'guardianEmail',
] as const;

export type StudentField = (typeof STUDENT_FIELDS)[number];

export const FIELD_LABELS: Readonly<Record<StudentField, string>> = {
  firstName: 'First name',
  lastName: 'Last name',
  displayName: 'Display name',
  dateOfBirth: 'Date of birth',
  gradeLevel: 'Grade level',
  schoolName: 'School',
  phase: 'Phase',
  studentEmail: 'Student email (13+)',
  guardianName: 'Guardian name',
  guardianEmail: 'Guardian email',
};

// displayName is not required in the mapping: mapRows falls back to the
// first name when a file has no display-name column.
export const REQUIRED_FIELDS: readonly StudentField[] = ['firstName', 'lastName', 'dateOfBirth'];

/** header column index per field; -1 = not mapped. */
export type ColumnMapping = Record<StudentField, number>;

const HEADER_ALIASES: Readonly<Record<StudentField, readonly string[]>> = {
  firstName: ['firstname', 'first', 'givenname'],
  lastName: ['lastname', 'last', 'surname', 'familyname'],
  displayName: ['displayname', 'display', 'nickname', 'preferredname', 'goesby'],
  dateOfBirth: ['dateofbirth', 'dob', 'birthdate', 'birthday', 'born'],
  gradeLevel: ['gradelevel', 'grade'],
  schoolName: ['schoolname', 'school'],
  phase: ['phase', 'cohort'],
  studentEmail: ['studentemail', 'email', 'emailaddress'],
  guardianName: ['guardianname', 'guardian', 'parentname', 'parent', 'parentguardian'],
  guardianEmail: ['guardianemail', 'parentemail', 'guardianemailaddress'],
};

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function autoMapColumns(headers: readonly string[]): ColumnMapping {
  const normalized = headers.map(normalizeHeader);
  const mapping = {} as ColumnMapping;
  const taken = new Set<number>();
  for (const field of STUDENT_FIELDS) {
    const aliases = HEADER_ALIASES[field];
    const index = normalized.findIndex((h, i) => !taken.has(i) && aliases.includes(h));
    mapping[field] = index;
    if (index >= 0) {
      taken.add(index);
    }
  }
  return mapping;
}

export type MappedRow =
  | { ok: true; line: number; input: CreateStudentInput }
  | { ok: false; line: number; problem: string };

/**
 * Applies the mapping to data rows (`line` is the 1-based CSV line, header
 * included, so it matches what the admin sees in her spreadsheet).
 */
export function mapRows(dataRows: readonly string[][], mapping: ColumnMapping): MappedRow[] {
  return dataRows.map((cells, i) => {
    const line = i + 2;
    const cell = (index: number): string => (index >= 0 ? (cells[index] ?? '').trim() : '');

    const firstName = cell(mapping.firstName);
    const lastName = cell(mapping.lastName);
    const displayName = cell(mapping.displayName) !== '' ? cell(mapping.displayName) : firstName;
    if (firstName === '' || lastName === '') {
      return { ok: false, line, problem: 'Missing first or last name' };
    }

    const dateOfBirth = toIsoDate(cell(mapping.dateOfBirth));
    if (dateOfBirth === null) {
      return { ok: false, line, problem: 'Date of birth is missing or not a real date' };
    }

    const input: CreateStudentInput = { firstName, lastName, displayName, dateOfBirth };
    if (cell(mapping.gradeLevel) !== '') {
      input.gradeLevel = cell(mapping.gradeLevel);
    }
    if (cell(mapping.schoolName) !== '') {
      input.schoolName = cell(mapping.schoolName);
    }
    if (cell(mapping.phase) !== '') {
      input.phase = cell(mapping.phase);
    }

    const studentEmail = cell(mapping.studentEmail);
    if (studentEmail !== '') {
      if (!looksLikeEmail(studentEmail)) {
        return { ok: false, line, problem: 'Student email is not a valid address' };
      }
      // OD-19: an under-13's own email is never collected — the server would
      // reject the row; catching it here gives the admin the line number.
      if (isUnder13(dateOfBirth)) {
        return {
          ok: false,
          line,
          problem: 'Under-13 students use the guardian email, not their own',
        };
      }
      input.studentEmail = studentEmail;
    }

    const guardianName = cell(mapping.guardianName);
    const guardianEmail = cell(mapping.guardianEmail);
    if (guardianName !== '' || guardianEmail !== '') {
      if (guardianName === '' || guardianEmail === '') {
        return { ok: false, line, problem: 'Guardian name and email must both be filled in' };
      }
      if (!looksLikeEmail(guardianEmail)) {
        return { ok: false, line, problem: 'Guardian email is not a valid address' };
      }
      input.guardianName = guardianName;
      input.guardianEmail = guardianEmail;
    }
    return { ok: true, line, input };
  });
}

/** UX-grade check only — the Edge Function re-validates with a real schema. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

/** Age check for the OD-19 email rule (client-side courtesy of the same
 * server-enforced boundary). */
function isUnder13(isoDob: string): boolean {
  const dob = new Date(`${isoDob}T00:00:00Z`);
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) {
    age -= 1;
  }
  return age < 13;
}
