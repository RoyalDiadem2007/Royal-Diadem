/**
 * Minimal RFC 4180 CSV parser — quoted fields, escaped quotes (""), commas
 * inside quotes, LF/CRLF endings. A dependency would be overkill for this
 * (CLAUDE.md §8); the enrollment CSVs are small admin-authored files.
 */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const pushField = (): void => {
    row.push(field);
    field = '';
  };
  const pushRow = (): void => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char ?? '';
      i += 1;
      continue;
    }
    if (char === '"' && field === '') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ',') {
      pushField();
      i += 1;
      continue;
    }
    if (char === '\r' && text[i + 1] === '\n') {
      pushRow();
      i += 2;
      continue;
    }
    if (char === '\n' || char === '\r') {
      pushRow();
      i += 1;
      continue;
    }
    field += char ?? '';
    i += 1;
  }
  // Final field/row unless the file ended exactly on a row break.
  if (field !== '' || row.length > 0) {
    pushRow();
  }

  // Drop fully empty trailing lines (a common artifact of exports).
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/**
 * Normalizes the date formats admin spreadsheets actually produce —
 * YYYY-MM-DD or M/D/YYYY — to ISO YYYY-MM-DD. Returns null when unparseable
 * or not a real calendar date.
 */
export function toIsoDate(raw: string): string | null {
  const value = raw.trim();
  let year: number, month: number, day: number;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (iso !== null) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (us !== null) {
    month = Number(us[1]);
    day = Number(us[2]);
    year = Number(us[3]);
  } else {
    return null;
  }

  const candidate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const parsed = new Date(`${candidate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || !parsed.toISOString().startsWith(candidate)) {
    return null;
  }
  return candidate;
}
