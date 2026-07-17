/**
 * CSV import wizard tests: real parser, real mapping, real component flow —
 * only fetch (the network boundary) is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CsvImport } from '@/components/admin/CsvImport';

const CSV_TEXT = [
  'First Name,Last Name,DOB,Grade',
  'Ava,Example,9/5/2012,7th',
  'Zoe,Little,2014-01-20,5th',
  ',Broken,2013-02-02,6th',
].join('\n');

const IMPORTED_AVA = {
  id: 'stu-a',
  firstName: 'Ava',
  lastName: 'Example',
  displayName: 'Ava',
  loginCode: 'RD-AAAA',
  status: 'active',
  coppaRequired: false,
  coppaConsentStatus: 'pending',
  phase: null,
  enrollmentDate: '2026-07-17T00:00:00.000Z',
};

const IMPORTED_ZOE = { ...IMPORTED_AVA, id: 'stu-z', displayName: 'Zoe', loginCode: 'RD-ZZZZ' };

function stubImportFetch(bodies: Record<string, unknown>[]): unknown[] {
  const requests: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (!target.endsWith('/admin-students/import')) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      requests.push(typeof init?.body === 'string' ? JSON.parse(init.body) : null);
      const body = bodies.shift() ?? { results: [] };
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }),
  );
  return requests;
}

async function uploadAndReachMapStep(): Promise<void> {
  const file = new File([CSV_TEXT], 'students.csv', { type: 'text/csv' });
  await userEvent.setup().upload(screen.getByLabelText('Choose CSV file'), file);
  await screen.findByRole('heading', { name: 'Match the columns' });
}

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('CsvImport wizard', () => {
  it('auto-maps recognizable headers and reports broken rows before upload', async () => {
    stubImportFetch([]);
    render(
      <CsvImport sessionToken="tok" onFinished={() => undefined} onCancel={() => undefined} />,
    );
    await uploadAndReachMapStep();

    expect(screen.getByText('2 of 3 rows ready to import.')).toBeInTheDocument();
    expect(screen.getByText(/Line 4: Missing first or last name/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import 2 students' })).toBeEnabled();
  });

  it('imports the valid rows and shows the one-time printable card sheet', async () => {
    const requests = stubImportFetch([
      {
        results: [
          { index: 0, ok: true, student: IMPORTED_AVA, pin: '112233' },
          { index: 1, ok: true, student: IMPORTED_ZOE, pin: '445566' },
        ],
      },
    ]);
    render(
      <CsvImport sessionToken="tok" onFinished={() => undefined} onCancel={() => undefined} />,
    );
    await uploadAndReachMapStep();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Import 2 students' }));
    await screen.findByRole('heading', { name: 'Import finished' });

    expect(
      screen.getByText('2 enrolled · 0 failed · 1 skipped before upload.'),
    ).toBeInTheDocument();
    expect(screen.getByText('PIN: 112233')).toBeInTheDocument();
    expect(screen.getByText('PIN: 445566')).toBeInTheDocument();
    expect(screen.getByText(/shown only this once/)).toBeInTheDocument();
    // Only the two valid rows were uploaded, in one chunk.
    expect(requests).toHaveLength(1);
  });

  it('reports duplicates from the server against their CSV lines', async () => {
    stubImportFetch([
      {
        results: [
          { index: 0, ok: true, student: IMPORTED_AVA, pin: '112233' },
          { index: 1, ok: false, reason: 'duplicate' },
        ],
      },
    ]);
    render(
      <CsvImport sessionToken="tok" onFinished={() => undefined} onCancel={() => undefined} />,
    );
    await uploadAndReachMapStep();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Import 2 students' }));
    await screen.findByRole('heading', { name: 'Import finished' });

    expect(
      screen.getByText('1 enrolled · 1 failed · 1 skipped before upload.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Line 3: Already enrolled \(same name and birth date\)/),
    ).toBeInTheDocument();
  });

  it('disables importing until every required field is mapped', async () => {
    stubImportFetch([]);
    render(
      <CsvImport sessionToken="tok" onFinished={() => undefined} onCancel={() => undefined} />,
    );
    await uploadAndReachMapStep();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Date of birth'), '-1');
    expect(screen.getByRole('button', { name: /Import/ })).toBeDisabled();
  });
});
