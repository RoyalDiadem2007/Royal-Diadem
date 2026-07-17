import { describe, expect, it } from 'vitest';
import { autoMapColumns, mapRows } from '@/lib/csvMapping';

describe('autoMapColumns', () => {
  it('matches common header spellings regardless of case and punctuation', () => {
    const mapping = autoMapColumns(['First Name', 'LAST_NAME', 'D.O.B.', 'Goes By', 'Grade']);
    expect(mapping.firstName).toBe(0);
    expect(mapping.lastName).toBe(1);
    expect(mapping.dateOfBirth).toBe(2);
    expect(mapping.displayName).toBe(3);
    expect(mapping.gradeLevel).toBe(4);
  });

  it('leaves unknown fields unmapped', () => {
    const mapping = autoMapColumns(['First Name', 'Last Name', 'Favorite Color']);
    expect(mapping.dateOfBirth).toBe(-1);
    expect(mapping.schoolName).toBe(-1);
    expect(mapping.phase).toBe(-1);
  });

  it('never assigns one column to two fields', () => {
    const mapping = autoMapColumns(['name', 'first', 'first name']);
    const used = Object.values(mapping).filter((i) => i >= 0);
    expect(new Set(used).size).toBe(used.length);
  });
});

describe('mapRows', () => {
  const mapping = autoMapColumns(['First Name', 'Last Name', 'DOB', 'Display Name', 'School']);

  it('maps a valid row and reports its spreadsheet line number', () => {
    const rows = mapRows([['Ava', 'Example', '9/5/2012', 'Avie', 'Studewood MS']], mapping);
    expect(rows[0]).toEqual({
      ok: true,
      line: 2,
      input: {
        firstName: 'Ava',
        lastName: 'Example',
        displayName: 'Avie',
        dateOfBirth: '2012-09-05',
        schoolName: 'Studewood MS',
      },
    });
  });

  it('falls back to the first name when display name is blank', () => {
    const rows = mapRows([['Ava', 'Example', '2012-09-05', '', '']], mapping);
    expect(rows[0]?.ok).toBe(true);
    if (rows[0]?.ok === true) {
      expect(rows[0].input.displayName).toBe('Ava');
    }
  });

  it('flags missing names and bad dates with their line numbers', () => {
    const rows = mapRows(
      [
        ['', 'Example', '2012-09-05', '', ''],
        ['Zoe', 'Little', 'not-a-date', '', ''],
      ],
      mapping,
    );
    expect(rows[0]).toEqual({ ok: false, line: 2, problem: 'Missing first or last name' });
    expect(rows[1]).toEqual({
      ok: false,
      line: 3,
      problem: 'Date of birth is missing or not a real date',
    });
  });
});
