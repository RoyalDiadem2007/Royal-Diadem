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
    return { ok: true, line, input };
  });
}
