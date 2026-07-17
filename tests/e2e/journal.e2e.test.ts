/**
 * END-TO-END journal tests (Phase 6) — no mocks. Real HTTP → real Edge
 * Functions → real Postgres: REAL AES-256-GCM at rest (the database row must
 * not contain the plaintext), decryption for the author and the reviewer,
 * keyword flagging with category-only reasons, prompt lifecycle, guardian
 * grant reads, RBAC denials, audit rows.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callFunction, restDelete, restInsert, restSelect, restUpdate, API_URL } from './stack.ts';

const PIN_HASH_123456 = '$2b$12$6dESXMU6poUgaUoSTSce.ezSDJsy6vs4Pn4Ho5DFPOxoaxxXpRjMq';
const PIN = '123456';
const TURNSTILE_TOKEN = 'e2e-test-token-XXXX.DUMMY.TOKEN.XXXX';

const MARKER_SCHOOL = 'rd-e2ejr-school';
const SUPER_EMAIL = 'e2e-jr-super@example.com';
const MENTOR_EMAIL = 'e2e-jr-mentor@example.com';
const GUARDIAN_EMAIL = 'e2e-jr-guardian@example.com';

let superId = '';
let superToken = '';
let studentId = '';
let studentToken = '';

const PRIVATE_TEXT = 'today felt heavy but choir practice helped';
const CONCERNING_TEXT = 'sometimes I want to hurt myself and I do not know who to tell';

function requireId(row: Record<string, unknown> | undefined, what: string): string {
  const id = row?.id;
  if (typeof id !== 'string' || id === '') {
    throw new Error(`seeding ${what} failed`);
  }
  return id;
}

function dobYearsAgo(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() - 30);
  return d.toISOString().slice(0, 10);
}

async function tokenOf(
  subjectType: 'student' | 'admin' | 'guardian',
  identifier: string,
  pin = PIN,
): Promise<string> {
  const res = await callFunction('auth-login', {
    method: 'POST',
    body: { subjectType, identifier, pin, turnstileToken: TURNSTILE_TOKEN },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { token?: string };
  if (typeof body.token !== 'string') {
    throw new Error(`${subjectType} login fixture failed`);
  }
  return body.token;
}

async function cleanup(): Promise<void> {
  const students = await restSelect('students', `school_name=eq.${MARKER_SCHOOL}&select=id`);
  const ids = students.map((s) => String(s.id));
  if (ids.length > 0) {
    const filter = `student_id=in.(${ids.join(',')})`;
    const entries = await restSelect('journal_entries', `${filter}&select=id`);
    const entryIds = entries.map((e) => String(e.id));
    if (entryIds.length > 0) {
      // Flags have no DELETE grant — resolve instead (same as other suites).
      await restUpdate('flags', `entity_type=eq.journal&entity_id=in.(${entryIds.join(',')})`, {
        status: 'resolved',
      });
      await restDelete('journal_entries', `id=in.(${entryIds.join(',')})`);
    }
    await restDelete('guardian_access_requests', filter);
    await restDelete('magic_links', filter);
    await restDelete('guardians', filter);
    await restDelete('sessions', `subject_id=in.(${ids.join(',')})`);
    await restDelete('students', `id=in.(${ids.join(',')})`);
  }
  const accounts = await restSelect('guardian_accounts', `email=like.e2e-jr-%&select=id`);
  if (accounts.length > 0) {
    const accountIds = accounts.map((a) => String(a.id));
    await restDelete('guardian_access_requests', `account_id=in.(${accountIds.join(',')})`);
    await restDelete('sessions', `subject_id=in.(${accountIds.join(',')})`);
    await restDelete('guardian_accounts', `id=in.(${accountIds.join(',')})`);
  }
  const admins = await restSelect(
    'admin_users',
    `email=in.(${SUPER_EMAIL},${MENTOR_EMAIL})&select=id`,
  );
  if (admins.length > 0) {
    await restDelete('sessions', `subject_id=in.(${admins.map((a) => String(a.id)).join(',')})`);
  }
  await restDelete('journal_prompts', 'prompt_text=like.rd-e2ejr%');
  await restDelete('auth_rate_limits', 'limit_key=like.login%');
  await restDelete('admin_users', `email=in.(${SUPER_EMAIL},${MENTOR_EMAIL})`);
}

beforeAll(async () => {
  const reachable = await fetch(`${API_URL}/rest/v1/`, { method: 'HEAD' })
    .then((ping) => ping.status < 500)
    .catch(() => false);
  if (!reachable) {
    throw new Error(
      `Local Supabase stack is not reachable at ${API_URL}. Run: npx supabase start && npx supabase functions serve --env-file supabase/functions/.env`,
    );
  }

  await cleanup();
  const admins = await restInsert('admin_users', [
    { name: 'JR Super', role: 'super_admin', pin_hash: PIN_HASH_123456, email: SUPER_EMAIL },
    { name: 'JR Mentor', role: 'mentor', pin_hash: PIN_HASH_123456, email: MENTOR_EMAIL },
  ]);
  superId = requireId(admins[0], 'admin_users');
  superToken = await tokenOf('admin', SUPER_EMAIL);

  const created = await callFunction('admin-students/create', {
    method: 'POST',
    bearer: superToken,
    body: {
      firstName: 'Jade',
      lastName: 'Writer',
      displayName: 'Jade',
      dateOfBirth: dobYearsAgo(14),
      schoolName: MARKER_SCHOOL,
      guardianName: 'Ola Writer',
      guardianEmail: GUARDIAN_EMAIL,
    },
  });
  expect(created.status).toBe(201);
  const body = (await created.json()) as {
    student: { id: string; loginCode: string };
    pin: string;
  };
  studentId = body.student.id;
  studentToken = await tokenOf('student', body.student.loginCode, body.pin);
});

afterAll(cleanup);

describe('journal (E2E, no mocks)', () => {
  let promptId = '';
  let flaggedEntryId = '';

  it('admin creates a prompt and the student sees it', async () => {
    const created = await callFunction('admin-journal/prompts', {
      method: 'POST',
      bearer: superToken,
      body: { text: 'rd-e2ejr: What made you feel strong today?' },
    });
    expect(created.status).toBe(201);
    promptId = ((await created.json()) as { prompt: { id: string } }).prompt.id;

    const home = await callFunction('journal', { method: 'GET', bearer: studentToken });
    expect(home.status).toBe(200);
    const homeBody = (await home.json()) as { prompts: { id: string }[] };
    expect(homeBody.prompts.some((p) => p.id === promptId)).toBe(true);
  });

  it('encrypts at rest: the database row never contains the plaintext', async () => {
    const res = await callFunction('journal', {
      method: 'POST',
      bearer: studentToken,
      body: { promptId, text: PRIVATE_TEXT },
    });
    expect(res.status).toBe(201);

    const rows = await restSelect(
      'journal_entries',
      `student_id=eq.${studentId}&select=entry_ciphertext,entry_iv,ai_flag_triggered`,
    );
    expect(rows).toHaveLength(1);
    const raw = JSON.stringify(rows[0]);
    expect(raw.includes(PRIVATE_TEXT)).toBe(false);
    expect(raw.includes('choir')).toBe(false);
    expect(String(rows[0]?.entry_iv).length).toBeGreaterThan(10);
    expect(rows[0]?.ai_flag_triggered).toBe(false);

    // …and decrypts for the author, with the prompt attached.
    const home = await callFunction('journal', { method: 'GET', bearer: studentToken });
    const homeBody = (await home.json()) as {
      entries: { text: string; promptText: string | null }[];
    };
    expect(homeBody.entries[0]?.text).toBe(PRIVATE_TEXT);
    expect(homeBody.entries[0]?.promptText).toContain('feel strong');
  });

  it('flags concerning language with a category-only reason', async () => {
    const res = await callFunction('journal', {
      method: 'POST',
      bearer: studentToken,
      body: { text: CONCERNING_TEXT },
    });
    expect(res.status).toBe(201);

    const rows = await restSelect(
      'journal_entries',
      `student_id=eq.${studentId}&ai_flag_triggered=eq.true&select=id,ai_flag_reason`,
    );
    expect(rows).toHaveLength(1);
    flaggedEntryId = String(rows[0]?.id);
    const reason = String(rows[0]?.ai_flag_reason);
    expect(reason).toContain('self-harm language');
    expect(reason.includes('hurt myself')).toBe(false); // category, never contents

    const flags = await restSelect(
      'flags',
      `entity_type=eq.journal&entity_id=eq.${flaggedEntryId}&select=severity,status,source`,
    );
    expect(flags).toHaveLength(1);
    expect(flags[0]?.severity).toBe('high');
    expect(flags[0]?.source).toBe('ai');
  });

  it('gives the reviewer decrypted entries + the needs-review mark, audited', async () => {
    const roster = await callFunction('admin-journal', { method: 'GET', bearer: superToken });
    expect(roster.status).toBe(200);
    const rosterBody = (await roster.json()) as {
      students: { studentId: string; entryCount: number; needsReview: boolean }[];
    };
    const jade = rosterBody.students.find((s) => s.studentId === studentId);
    expect(jade?.entryCount).toBe(2);
    expect(jade?.needsReview).toBe(true);

    const detail = await callFunction(`admin-journal/student?studentId=${studentId}`, {
      method: 'GET',
      bearer: superToken,
    });
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as {
      entries: { text: string; aiFlagTriggered: boolean }[];
    };
    expect(detailBody.entries.some((e) => e.text === PRIVATE_TEXT)).toBe(true);
    expect(detailBody.entries.some((e) => e.text === CONCERNING_TEXT && e.aiFlagTriggered)).toBe(
      true,
    );

    const audits = await restSelect(
      'audit_logs',
      `actor_id=eq.${superId}&entity_type=eq.journal&entity_id=eq.${studentId}&outcome=eq.allowed&limit=1`,
    );
    expect(audits).toHaveLength(1);
  });

  it('lets a guardian read entries only inside a grant window', async () => {
    // Portal-enabled guardian account, linked, with an approved window.
    const accounts = await restInsert('guardian_accounts', [
      { email: GUARDIAN_EMAIL, display_name: 'Ola Writer', pin_hash: PIN_HASH_123456 },
    ]);
    const accountId = requireId(accounts[0], 'guardian_accounts');
    const guardians = await restSelect('guardians', `student_id=eq.${studentId}&select=id`);
    const guardianId = requireId(guardians[0], 'guardians');
    await restUpdate('guardians', `id=eq.${guardianId}`, { account_id: accountId });

    const guardianToken = await tokenOf('guardian', GUARDIAN_EMAIL);

    // No grant yet → refused.
    const early = await callFunction(`guardian-portal/student?studentId=${studentId}`, {
      method: 'GET',
      bearer: guardianToken,
    });
    expect(early.status).toBe(403);

    await restInsert('guardian_access_requests', [
      {
        account_id: accountId,
        guardian_id: guardianId,
        student_id: studentId,
        status: 'approved',
        granted_at: new Date().toISOString(),
        access_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      },
    ]);

    const view = await callFunction(`guardian-portal/student?studentId=${studentId}`, {
      method: 'GET',
      bearer: guardianToken,
    });
    expect(view.status).toBe(200);
    const viewBody = (await view.json()) as { journal: { text: string }[] };
    expect(viewBody.journal.some((e) => e.text === PRIVATE_TEXT)).toBe(true);
  });

  it('retiring a prompt removes it from the student picker', async () => {
    const toggled = await callFunction('admin-journal/prompts/toggle', {
      method: 'POST',
      bearer: superToken,
      body: { promptId, active: false },
    });
    expect(toggled.status).toBe(200);

    const home = await callFunction('journal', { method: 'GET', bearer: studentToken });
    const homeBody = (await home.json()) as { prompts: { id: string }[] };
    expect(homeBody.prompts.some((p) => p.id === promptId)).toBe(false);
  });

  it('denies a mentor (until OD-6) and a student on admin-journal, audited RBAC', async () => {
    const mentorToken = await tokenOf('admin', MENTOR_EMAIL);
    expect(
      (await callFunction('admin-journal', { method: 'GET', bearer: mentorToken })).status,
    ).toBe(403);
    expect(
      (await callFunction('admin-journal', { method: 'GET', bearer: studentToken })).status,
    ).toBe(403);
    expect((await callFunction('admin-journal', { method: 'GET' })).status).toBe(401);
  });

  it('rejects malformed writes with 400', async () => {
    const res = await callFunction('journal', {
      method: 'POST',
      bearer: studentToken,
      body: { text: '', extra: true },
    });
    expect(res.status).toBe(400);
  });
});
