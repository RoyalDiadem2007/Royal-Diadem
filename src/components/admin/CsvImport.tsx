/**
 * CSV bulk enrollment (Spec §6.10 enrollment tools): pick file → confirm the
 * column mapping (auto-guessed, admin-correctable) → chunked import with
 * progress → results with a printable one-time PIN card sheet. PINs exist
 * only in this render; printing the sheet is the hand-off.
 */
import { useState } from 'react';
import { parseCsv } from '@/lib/csv';
import {
  autoMapColumns,
  mapRows,
  FIELD_LABELS,
  REQUIRED_FIELDS,
  STUDENT_FIELDS,
  type ColumnMapping,
  type StudentField,
} from '@/lib/csvMapping';
import { importStudents, type ImportSummary } from '@/lib/adminStudents';

type Skipped = { line: number; problem: string };

type Stage =
  | { step: 'pick'; problem: string }
  | { step: 'map'; headers: string[]; dataRows: string[][]; mapping: ColumnMapping }
  | { step: 'importing'; done: number; total: number }
  | { step: 'results'; summary: ImportSummary; skipped: Skipped[] };

const FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  duplicate: 'Already enrolled (same name and birth date)',
  server_error: 'Server error — not enrolled',
};

type Props = {
  sessionToken: string;
  onFinished: () => void;
  onCancel: () => void;
};

export function CsvImport({ sessionToken, onFinished, onCancel }: Props) {
  const [stage, setStage] = useState<Stage>({ step: 'pick', problem: '' });

  function handleFile(file: File): void {
    void file.text().then((text) => {
      const rows = parseCsv(text);
      if (rows.length < 2) {
        setStage({ step: 'pick', problem: 'That file has no data rows under its header.' });
        return;
      }
      const headers = rows[0] ?? [];
      setStage({
        step: 'map',
        headers,
        dataRows: rows.slice(1),
        mapping: autoMapColumns(headers),
      });
    });
  }

  function startImport(headersStage: Extract<Stage, { step: 'map' }>): void {
    const mapped = mapRows(headersStage.dataRows, headersStage.mapping);
    const valid = mapped.flatMap((r) => (r.ok ? [{ line: r.line, input: r.input }] : []));
    const skipped = mapped.flatMap((r) => (r.ok ? [] : [{ line: r.line, problem: r.problem }]));
    setStage({ step: 'importing', done: 0, total: valid.length });
    void importStudents(sessionToken, valid, (done, total) => {
      setStage({ step: 'importing', done, total });
    }).then((summary) => {
      setStage({ step: 'results', summary, skipped });
    });
  }

  if (stage.step === 'pick') {
    return (
      <div className="csv-import">
        <h3 className="admin-subsection-title">Import students from CSV</h3>
        <p className="admin-section-note">
          The first row must be column headers (e.g. First name, Last name, Date of birth). You
          confirm the column matching before anything is imported.
        </p>
        {stage.problem !== '' && (
          <p className="admin-section-note" role="alert">
            {stage.problem}
          </p>
        )}
        <label className="csv-file-label">
          <span>Choose CSV file</span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file !== undefined) {
                handleFile(file);
              }
            }}
          />
        </label>
        <button type="button" className="logout-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    );
  }

  if (stage.step === 'map') {
    const mapped = mapRows(stage.dataRows, stage.mapping);
    const validCount = mapped.filter((r) => r.ok).length;
    const problems = mapped.flatMap((r) => (r.ok ? [] : [r]));
    const requiredMapped = REQUIRED_FIELDS.every((f) => stage.mapping[f] >= 0);

    return (
      <div className="csv-import">
        <h3 className="admin-subsection-title">Match the columns</h3>
        <div className="csv-mapping-grid">
          {STUDENT_FIELDS.map((field: StudentField) => (
            <label key={field}>
              <span>
                {FIELD_LABELS[field]}
                {REQUIRED_FIELDS.includes(field) ? '' : ' (optional)'}
              </span>
              <select
                value={stage.mapping[field]}
                onChange={(e) => {
                  setStage({
                    ...stage,
                    mapping: { ...stage.mapping, [field]: Number(e.target.value) },
                  });
                }}
              >
                <option value={-1}>— not in this file —</option>
                {stage.headers.map((header, index) => (
                  <option key={`${String(index)}-${header}`} value={index}>
                    {header}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <p className="admin-section-note">
          {validCount} of {stage.dataRows.length} rows ready to import.
        </p>
        {problems.length > 0 && (
          <ul className="csv-problem-list">
            {problems.slice(0, 10).map((p) => (
              <li key={p.line}>
                Line {p.line}: {p.problem}
              </li>
            ))}
            {problems.length > 10 && <li>…and {problems.length - 10} more</li>}
          </ul>
        )}
        <div className="add-student-actions">
          <button
            type="button"
            className="admin-retry-button"
            disabled={!requiredMapped || validCount === 0}
            onClick={() => {
              startImport(stage);
            }}
          >
            Import {validCount} student{validCount === 1 ? '' : 's'}
          </button>
          <button type="button" className="logout-button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (stage.step === 'importing') {
    return (
      <div className="csv-import" aria-busy="true">
        <h3 className="admin-subsection-title">Importing…</h3>
        <p className="admin-section-note">
          {stage.done} of {stage.total} enrolled. Keep this page open.
        </p>
      </div>
    );
  }

  const successes = stage.summary.outcomes.flatMap((o) => (o.ok ? [o] : []));
  const failures = stage.summary.outcomes.flatMap((o) => (o.ok ? [] : [o]));

  return (
    <div className="csv-import">
      <h3 className="admin-subsection-title">Import finished</h3>
      {stage.summary.aborted && (
        <p className="admin-section-note" role="alert">
          The connection dropped partway through — the rows below are what completed. Re-running the
          same file is safe: already-enrolled students are skipped as duplicates.
        </p>
      )}
      <p className="admin-section-note">
        {successes.length} enrolled · {failures.length} failed · {stage.skipped.length} skipped
        before upload.
      </p>

      {successes.length > 0 && (
        <>
          <p className="issued-pin-warning">
            Print the card sheet now — these PINs are shown only this once and can&rsquo;t be looked
            up later.
          </p>
          <button
            type="button"
            className="admin-retry-button"
            onClick={() => {
              window.print();
            }}
          >
            Print card sheet
          </button>
          <div className="pin-card-sheet">
            {successes.map((s) => (
              <div className="pin-card" key={s.issued.student.id}>
                <span className="pin-card-name">{s.issued.student.displayName}</span>
                <span className="pin-card-row">Crown code: {s.issued.student.loginCode}</span>
                <span className="pin-card-row">PIN: {s.issued.pin}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {(failures.length > 0 || stage.skipped.length > 0) && (
        <ul className="csv-problem-list">
          {failures.map((f) => (
            <li key={f.line}>
              Line {f.line}: {FAILURE_MESSAGES[f.reason] ?? 'Not enrolled'}
            </li>
          ))}
          {stage.skipped.map((s) => (
            <li key={s.line}>
              Line {s.line}: {s.problem} (skipped)
            </li>
          ))}
        </ul>
      )}

      <button type="button" className="admin-retry-button" onClick={onFinished}>
        Done — cards printed
      </button>
    </div>
  );
}
