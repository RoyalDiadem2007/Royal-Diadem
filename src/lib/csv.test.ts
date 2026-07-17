import { describe, expect, it } from 'vitest';
import { parseCsv, toIsoDate } from '@/lib/csv';

describe('parseCsv', () => {
  it('parses plain rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles quoted fields containing commas and escaped quotes', () => {
    expect(parseCsv('name,note\n"Smith, Jr.","She said ""hi"""')).toEqual([
      ['name', 'note'],
      ['Smith, Jr.', 'She said "hi"'],
    ]);
  });

  it('handles CRLF endings and a trailing newline', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles newlines inside quoted fields', () => {
    expect(parseCsv('a,b\n"line1\nline2",x')).toEqual([
      ['a', 'b'],
      ['line1\nline2', 'x'],
    ]);
  });

  it('drops fully empty lines', () => {
    expect(parseCsv('a,b\n\n1,2\n,\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('toIsoDate', () => {
  it('accepts ISO dates', () => {
    expect(toIsoDate('2012-09-05')).toBe('2012-09-05');
  });

  it('accepts US M/D/YYYY dates', () => {
    expect(toIsoDate('9/5/2012')).toBe('2012-09-05');
    expect(toIsoDate('12/31/2011')).toBe('2011-12-31');
  });

  it('rejects impossible calendar dates', () => {
    expect(toIsoDate('2/30/2015')).toBeNull();
    expect(toIsoDate('2015-13-01')).toBeNull();
  });

  it('rejects garbage and empty input', () => {
    expect(toIsoDate('yesterday')).toBeNull();
    expect(toIsoDate('')).toBeNull();
    expect(toIsoDate('5-9-2012')).toBeNull();
  });
});
