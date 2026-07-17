/**
 * END-TO-END Crown Check tests — no mocks. Real HTTP → the real crown-check /
 * admin-crown-checks Edge Functions → real Postgres: real sessions, real
 * upsert against the daily unique index, real flag rows, real append-only
 * audit entries (allowed AND denied).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callFunction, restDelete, restInsert, restSelect, restUpdate, API_URL } from './stack.ts';

// bcrypt(12) of '123456' — fixture PIN for the E2E accounts (local stack only).
const PIN_HASH_123456 = '$2b$12$6dESXMU6poUgaUoSTSce.ezSDJsy6vs4Pn4Ho5DFPOxoaxxXpRjMq';
const PIN = '123456';
// Any token passes with the Turnstile test secret; length must satisfy the schema.
const TURNSTILE_TOKEN = 'e2e-test-token-XXXX.DUMMY.TOKEN.XXXX';

// Distinct fixture namespace — other suites clean different prefixes.
const STUDENT_CODE = 'rd-e2eck-a';
const STUDENT_CODE_QUIET = 'rd-e2eck-b';
const SUPER_EMAIL = 'e2e-crown-super@example.com';
const MENTOR_EMAIL = 'e2e-crown-mentor@example.com';

let studentId = '';
let quietStudentId = '';
let superId = '';

function requireId(row: Record<string, unknown> | undefined, what: string): string {
  const id = row?.id;
  if (typeof id !== 'string' || id === '') {
    throw new Error(`seeding ${what} failed`);
  }
  return id;
}

async function login(subjectType: 'student' | 'admin', identifier: string): Promise<string> {
  const res = await callFunction('auth-login', {
    method: 'POST',
    body: { subjectType, identifier, pin: PIN, turnstileToken: TURNSTILE_TOKEN },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { token?: string };
  if (typeof body.token !== 'string') {
    throw new Error('login fixture did not return a token');
  }
  return body.token;
}

/** YYYY-MM-DD shifted back `days` from today in America/Chicago (the stack default). */
function chicagoDay(daysAgo: number): string {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const base = new Date(`${today}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() - daysAgo);
  return base.toISOString().slice(0, 10);
}

/**
 * Id-independent cleanup so it also repairs leftovers from an interrupted
 * earlier run. Flags are append-only by design (no DELETE grant — safety
 * history is permanent), so seeded flags are resolved, never deleted.
 */
async function cleanup(): Promise<void> {
  const students = await restSelect('students', 'login_code=like.rd-e2eck-%&select=id');
  const studentIds = students.map((s) => String(s.id));
  if (studentIds.length > 0) {
    const checks = await restSelect(
      'crown_checks',
      `student_id=in.(${studentIds.join(',')})&select=id`,
    );
    const checkIds = checks.map((c) => String(c.id));
    if (checkIds.length > 0) {
      await restUpdate('flags', `entity_id=in.(${checkIds.join(',')})`, { status: 'resolved' });
      await restDelete('crown_checks', `id=in.(${checkIds.join(',')})`);
    }
    await restDelete('sessions', `subject_id=in.(${studentIds.join(',')})`);
  }
  const admins = await restSelect(
    'admin_users',
    `email=in.(${SUPER_EMAIL},${MENTOR_EMAIL})&select=id`,
  );
  if (admins.length > 0) {
    await restDelete('sessions', `subject_id=in.(${admins.map((a) => String(a.id)).join(',')})`);
  }
  await restDelete('auth_rate_limits', 'limit_key=like.login%');
  await restDelete('students', 'login_code=like.rd-e2eck-%');
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
    { name: 'Crown Super', role: 'super_admin', pin_hash: PIN_HASH_123456, email: SUPER_EMAIL },
    { name: 'Crown Mentor', role: 'mentor', pin_hash: PIN_HASH_123456, email: MENTOR_EMAIL },
  ]);
  superId = requireId(admins[0], 'admin_users');

  const students = await restInsert('students', [
    {
      first_name: 'Elise',
      last_name: 'Crown',
      display_name: 'Elise',
      date_of_birth: '2011-05-01',
      pin_hash: PIN_HASH_123456,
      login_code: STUDENT_CODE,
      status: 'active',
      coppa_required: false,
      coppa_consent_status: 'verified',
    },
    {
      first_name: 'Faith',
      last_name: 'Crown',
      display_name: 'Faith',
      date_of_birth: '2012-06-02',
      pin_hash: PIN_HASH_123456,
      login_code: STUDENT_CODE_QUIET,
      status: 'active',
      coppa_required: false,
      coppa_consent_status: 'verified',
    },
  ]);
  studentId = requireId(students[0], 'students');
  quietStudentId = requireId(students[1], 'students');
});

afterAll(cleanup);

describe('crown-check Edge Function (E2E, no mocks)', () => {
  it('creates today’s check with 201, stores the program-local day, audits the create', async () => {
    const token = await login('student', STUDENT_CODE);

    const res = await callFunction('crown-check', {
      method: 'POST',
      bearer: token,
      body: { moodScore: 4, moodEmoji: '😊', note: 'good day at school' },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { check: Record<string, unknown> };
    expect(body.check.moodScore).toBe(4);
    expect(body.check.checkDate).toBe(chicagoDay(0));
    // Flag state never crosses the student wire — not even as a field.
    expect('aiFlagTriggered' in body.check).toBe(false);

    const rows = await restSelect('crown_checks', `student_id=eq.${studentId}&select=*`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.mood_score).toBe(4);
    expect(rows[0]?.check_date).toBe(chicagoDay(0));

    const audits = await restSelect(
      'audit_logs',
      `actor_id=eq.${studentId}&entity_type=eq.crown_check&action=eq.create&outcome=eq.allowed&order=created_at.desc&limit=1`,
    );
    expect(audits).toHaveLength(1);
  });

  it('updates the same row on a same-day resubmit (200, no duplicate)', async () => {
    const token = await login('student', STUDENT_CODE);

    const res = await callFunction('crown-check', {
      method: 'POST',
      bearer: token,
      body: { moodScore: 5, moodEmoji: '👑' },
    });
    expect(res.status).toBe(200);

    const rows = await restSelect('crown_checks', `student_id=eq.${studentId}&select=*`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.mood_score).toBe(5);
    // The omitted note cleared the earlier one — the form sends full state.
    expect(rows[0]?.note).toBeNull();

    const audits = await restSelect(
      'audit_logs',
      `actor_id=eq.${studentId}&entity_type=eq.crown_check&action=eq.update&outcome=eq.allowed&order=created_at.desc&limit=1`,
    );
    expect(audits).toHaveLength(1);
  });

  it('returns today + recent history to the student, flag-free', async () => {
    const token = await login('student', STUDENT_CODE);

    const res = await callFunction('crown-check', { method: 'GET', bearer: token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      today: Record<string, unknown> | null;
      recent: Record<string, unknown>[];
    };
    expect(body.today?.moodScore).toBe(5);
    expect(body.recent.length).toBeGreaterThanOrEqual(1);
    for (const entry of body.recent) {
      expect('aiFlagTriggered' in entry).toBe(false);
      expect('aiFlagReason' in entry).toBe(false);
    }
  });

  it('raises ONE high-severity flag after 3 consecutive low days, and only one', async () => {
    // Two seeded low days before today, then a low submit today = 3 in a row.
    await restInsert('crown_checks', [
      { student_id: studentId, mood_score: 2, mood_emoji: '😟', check_date: chicagoDay(2) },
      { student_id: studentId, mood_score: 1, mood_emoji: '😢', check_date: chicagoDay(1) },
    ]);

    const token = await login('student', STUDENT_CODE);
    const res = await callFunction('crown-check', {
      method: 'POST',
      bearer: token,
      body: { moodScore: 2, moodEmoji: '😟', note: 'tired of everything' },
    });
    expect(res.status).toBe(200); // today's row existed from the earlier test

    const checks = await restSelect(
      'crown_checks',
      `student_id=eq.${studentId}&check_date=eq.${chicagoDay(0)}&select=id,ai_flag_triggered,ai_flag_reason`,
    );
    expect(checks[0]?.ai_flag_triggered).toBe(true);
    expect(String(checks[0]?.ai_flag_reason)).toContain('3 consecutive');

    const checkId = String(checks[0]?.id);
    const flags = await restSelect(
      'flags',
      `entity_type=eq.crown_check&entity_id=eq.${checkId}&select=*`,
    );
    expect(flags).toHaveLength(1);
    expect(flags[0]?.source).toBe('ai');
    expect(flags[0]?.severity).toBe('high');
    expect(flags[0]?.status).toBe('new');
    expect(flags[0]?.flagged_by).toBeNull();

    // Another low submit while the flag is open must NOT raise a second one.
    const again = await callFunction('crown-check', {
      method: 'POST',
      bearer: token,
      body: { moodScore: 1, moodEmoji: '😢' },
    });
    expect(again.status).toBe(200);

    const allCheckIds = (
      await restSelect('crown_checks', `student_id=eq.${studentId}&select=id`)
    ).map((c) => String(c.id));
    const allFlags = await restSelect(
      'flags',
      `entity_type=eq.crown_check&entity_id=in.(${allCheckIds.join(',')})&select=id,status`,
    );
    expect(allFlags).toHaveLength(1);
  });

  it('flags a NEW episode once the earlier flag is resolved', async () => {
    const checkIds = (await restSelect('crown_checks', `student_id=eq.${studentId}&select=id`)).map(
      (c) => String(c.id),
    );
    await restUpdate('flags', `entity_id=in.(${checkIds.join(',')})`, { status: 'resolved' });

    const token = await login('student', STUDENT_CODE);
    const res = await callFunction('crown-check', {
      method: 'POST',
      bearer: token,
      body: { moodScore: 1, moodEmoji: '😢' },
    });
    expect(res.status).toBe(200);

    const allFlags = await restSelect(
      'flags',
      `entity_type=eq.crown_check&entity_id=in.(${checkIds.join(',')})&select=id,status`,
    );
    expect(allFlags).toHaveLength(2);
    expect(allFlags.filter((f) => f.status === 'new')).toHaveLength(1);
  });

  it('never flags a student whose scores are fine', async () => {
    const token = await login('student', STUDENT_CODE_QUIET);
    const res = await callFunction('crown-check', {
      method: 'POST',
      bearer: token,
      body: { moodScore: 4, moodEmoji: '😊' },
    });
    expect(res.status).toBe(201);

    const checks = await restSelect(
      'crown_checks',
      `student_id=eq.${quietStudentId}&select=id,ai_flag_triggered`,
    );
    expect(checks[0]?.ai_flag_triggered).toBe(false);
    const flags = await restSelect(
      'flags',
      `entity_type=eq.crown_check&entity_id=eq.${String(checks[0]?.id)}&select=id`,
    );
    expect(flags).toHaveLength(0);
  });

  it('rejects a malformed body with 400 and writes nothing', async () => {
    const token = await login('student', STUDENT_CODE_QUIET);
    const res = await callFunction('crown-check', {
      method: 'POST',
      bearer: token,
      body: { moodScore: 9, moodEmoji: '😊', extra: 'nope' },
    });
    expect(res.status).toBe(400);
  });

  it('blocks a deactivated student mid-session with 403 and audits the denial', async () => {
    const token = await login('student', STUDENT_CODE_QUIET);
    await restUpdate('students', `id=eq.${quietStudentId}`, { status: 'inactive' });

    const res = await callFunction('crown-check', {
      method: 'POST',
      bearer: token,
      body: { moodScore: 3, moodEmoji: '😐' },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('account_unavailable');

    const audits = await restSelect(
      'audit_logs',
      `actor_id=eq.${quietStudentId}&entity_type=eq.crown_check&outcome=eq.denied&order=created_at.desc&limit=1`,
    );
    expect(audits).toHaveLength(1);

    await restUpdate('students', `id=eq.${quietStudentId}`, { status: 'active' });
  });

  it('rejects an admin session on the student endpoint with 403', async () => {
    const token = await login('admin', SUPER_EMAIL);
    const res = await callFunction('crown-check', {
      method: 'POST',
      bearer: token,
      body: { moodScore: 3, moodEmoji: '😐' },
    });
    expect(res.status).toBe(403);
  });

  it('rejects a missing token with 401', async () => {
    const res = await callFunction('crown-check', {
      method: 'POST',
      body: { moodScore: 3, moodEmoji: '😐' },
    });
    expect(res.status).toBe(401);
  });
});

describe('admin-crown-checks Edge Function (E2E, no mocks)', () => {
  it('returns the roster with trends and the needs-review indicator to a super admin', async () => {
    const token = await login('admin', SUPER_EMAIL);

    const res = await callFunction('admin-crown-checks', { method: 'GET', bearer: token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      students: {
        studentId: string;
        needsReview: boolean;
        lastCheck: { moodScore: number } | null;
        recent: { checkDate: string; moodScore: number }[];
      }[];
    };

    const elise = body.students.find((s) => s.studentId === studentId);
    expect(elise).toBeDefined();
    expect(elise?.needsReview).toBe(true); // her second episode is still open
    expect(elise?.lastCheck?.moodScore).toBe(1);
    expect(elise?.recent.length).toBeGreaterThanOrEqual(3);

    const faith = body.students.find((s) => s.studentId === quietStudentId);
    expect(faith?.needsReview).toBe(false);

    const audits = await restSelect(
      'audit_logs',
      `actor_id=eq.${superId}&entity_type=eq.crown_check&outcome=eq.allowed&order=created_at.desc&limit=1`,
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe('read');
  });

  it('returns one student’s series with notes and flag reasons, and audits with her id', async () => {
    const token = await login('admin', SUPER_EMAIL);

    const res = await callFunction(`admin-crown-checks/student?studentId=${studentId}`, {
      method: 'GET',
      bearer: token,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      student: { studentId: string; needsReview: boolean };
      checks: { checkDate: string; note: string | null; aiFlagTriggered: boolean }[];
    };
    expect(body.student.studentId).toBe(studentId);
    expect(body.checks.length).toBeGreaterThanOrEqual(3);
    expect(body.checks.some((c) => c.aiFlagTriggered)).toBe(true);

    const audits = await restSelect(
      'audit_logs',
      `actor_id=eq.${superId}&entity_type=eq.crown_check&entity_id=eq.${studentId}&outcome=eq.allowed&limit=1`,
    );
    expect(audits).toHaveLength(1);
  });

  it('404s an unknown student id and 400s a malformed one', async () => {
    const token = await login('admin', SUPER_EMAIL);
    const missing = await callFunction(
      'admin-crown-checks/student?studentId=00000000-0000-4000-8000-000000000000',
      { method: 'GET', bearer: token },
    );
    expect(missing.status).toBe(404);
    const malformed = await callFunction('admin-crown-checks/student?studentId=not-a-uuid', {
      method: 'GET',
      bearer: token,
    });
    expect(malformed.status).toBe(400);
  });

  it('denies a mentor with 403 until OD-6 lands, and audits the denial', async () => {
    const token = await login('admin', MENTOR_EMAIL);
    const res = await callFunction('admin-crown-checks', { method: 'GET', bearer: token });
    expect(res.status).toBe(403);
  });

  it('denies a student session with 403', async () => {
    const token = await login('student', STUDENT_CODE);
    const res = await callFunction('admin-crown-checks', { method: 'GET', bearer: token });
    expect(res.status).toBe(403);
  });

  it('rejects a missing token with 401', async () => {
    const res = await callFunction('admin-crown-checks', { method: 'GET' });
    expect(res.status).toBe(401);
  });
});
