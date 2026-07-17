/**
 * END-TO-END guardian portal tests (OD-19 build B) — no mocks beyond the
 * env-gated log email transport. Real HTTP → real Edge Functions → real
 * Postgres: real invite (account find-or-create + link), real portal claim
 * (guardian PIN + guardian session), the real consent-code ceremony end to
 * end across three actors (admin, guardian, student), real emergency grants,
 * real audit rows.
 */
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callFunction, restDelete, restInsert, restSelect, restUpdate, API_URL } from './stack.ts';

const PIN_HASH_123456 = '$2b$12$6dESXMU6poUgaUoSTSce.ezSDJsy6vs4Pn4Ho5DFPOxoaxxXpRjMq';
const PIN = '123456';
const TURNSTILE_TOKEN = 'e2e-test-token-XXXX.DUMMY.TOKEN.XXXX';

const MARKER_SCHOOL = 'rd-e2egp-school';
const SUPER_EMAIL = 'e2e-gp-super@example.com';
const GUARDIAN_EMAIL = 'e2e-gp-guardian@example.com';

let superId = '';
let superToken = '';

function requireId(row: Record<string, unknown> | undefined, what: string): string {
  const id = row?.id;
  if (typeof id !== 'string' || id === '') {
    throw new Error(`seeding ${what} failed`);
  }
  return id;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function dobYearsAgo(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() - 30);
  return d.toISOString().slice(0, 10);
}

async function login(subjectType: 'student' | 'admin' | 'guardian', identifier: string, pin = PIN) {
  return callFunction('auth-login', {
    method: 'POST',
    body: { subjectType, identifier, pin, turnstileToken: TURNSTILE_TOKEN },
  });
}

async function tokenOf(
  subjectType: 'student' | 'admin' | 'guardian',
  identifier: string,
  pin = PIN,
): Promise<string> {
  const res = await login(subjectType, identifier, pin);
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
    await restDelete('guardian_access_requests', filter);
    await restDelete('magic_links', filter);
    await restDelete('guardians', filter);
    const checks = await restSelect('crown_checks', `${filter}&select=id`);
    const checkIds = checks.map((c) => String(c.id));
    if (checkIds.length > 0) {
      await restUpdate('flags', `entity_id=in.(${checkIds.join(',')})`, { status: 'resolved' });
      await restDelete('crown_checks', `id=in.(${checkIds.join(',')})`);
    }
    await restDelete('sessions', `subject_id=in.(${ids.join(',')})`);
    await restDelete('students', `id=in.(${ids.join(',')})`);
  }
  const accounts = await restSelect('guardian_accounts', `email=like.e2e-gp-%&select=id`);
  if (accounts.length > 0) {
    const accountIds = accounts.map((a) => String(a.id));
    await restDelete('guardian_access_requests', `account_id=in.(${accountIds.join(',')})`);
    await restDelete('sessions', `subject_id=in.(${accountIds.join(',')})`);
    await restDelete('guardian_accounts', `id=in.(${accountIds.join(',')})`);
  }
  const admins = await restSelect('admin_users', `email=eq.${SUPER_EMAIL}&select=id`);
  if (admins.length > 0) {
    await restDelete('sessions', `subject_id=in.(${admins.map((a) => String(a.id)).join(',')})`);
  }
  await restDelete('auth_rate_limits', 'limit_key=like.login%');
  await restDelete('auth_rate_limits', 'limit_key=like.claim%');
  await restDelete('auth_rate_limits', 'limit_key=like.gcode%');
  await restDelete('admin_users', `email=eq.${SUPER_EMAIL}`);
}

async function enroll(input: Record<string, unknown>) {
  return callFunction('admin-students/create', {
    method: 'POST',
    bearer: superToken,
    body: { schoolName: MARKER_SCHOOL, ...input },
  });
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
    { name: 'GP Super', role: 'super_admin', pin_hash: PIN_HASH_123456, email: SUPER_EMAIL },
  ]);
  superId = requireId(admins[0], 'admin_users');
  superToken = await tokenOf('admin', SUPER_EMAIL);
});

afterAll(cleanup);

describe('guardian portal (E2E, no mocks)', () => {
  let studentId = '';
  let studentCode = '';
  let studentPin = '';
  let guardianPin = '';

  it('invites the guardian: account created + linked, portal magic link issued', async () => {
    const created = await enroll({
      firstName: 'Maya',
      lastName: 'Portal',
      displayName: 'Maya',
      dateOfBirth: dobYearsAgo(14),
      studentEmail: 'maya-gp@example.com',
      guardianName: 'Rae Portal',
      guardianEmail: GUARDIAN_EMAIL,
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      student: { id: string; loginCode: string };
      pin: string;
    };
    studentId = body.student.id;
    studentCode = body.student.loginCode;
    studentPin = body.pin;

    const invited = await callFunction('admin-students/invite-guardian', {
      method: 'POST',
      bearer: superToken,
      body: { studentId },
    });
    expect(invited.status).toBe(200);

    const accounts = await restSelect(
      'guardian_accounts',
      `email=eq.${GUARDIAN_EMAIL}&select=id,pin_hash`,
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.pin_hash).toBeNull(); // invited, not yet claimed

    const guardians = await restSelect('guardians', `student_id=eq.${studentId}&select=account_id`);
    expect(guardians[0]?.account_id).toBe(String(accounts[0]?.id));

    const links = await restSelect(
      'magic_links',
      `student_id=eq.${studentId}&purpose=eq.guardian_portal&select=recipient,revoked_at`,
    );
    expect(links).toHaveLength(1);
    expect(links[0]?.recipient).toBe('guardian');
  });

  it('refuses to invite for a 16+ student', async () => {
    const created = await enroll({
      firstName: 'Nia',
      lastName: 'Grown',
      displayName: 'Nia',
      dateOfBirth: dobYearsAgo(17),
      guardianName: 'Sam Grown',
      guardianEmail: 'e2e-gp-grown@example.com',
    });
    const { student } = (await created.json()) as { student: { id: string } };
    const res = await callFunction('admin-students/invite-guardian', {
      method: 'POST',
      bearer: superToken,
      body: { studentId: student.id },
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error?: string }).error).toBe('not_eligible');
  });

  it('claims the portal link: guardian PIN issued once, real guardian login works', async () => {
    // Seed a known-token portal link (the emailed one is hashed).
    const guardians = await restSelect('guardians', `student_id=eq.${studentId}&select=id`);
    const guardianId = requireId(guardians[0], 'guardians');
    const raw = randomBytes(32).toString('base64url');
    await restInsert('magic_links', [
      {
        student_id: studentId,
        recipient: 'guardian',
        guardian_id: guardianId,
        purpose: 'guardian_portal',
        token_hash: sha256Hex(raw),
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        created_by: superId,
      },
    ]);

    const res = await callFunction('magic-link-claim', {
      method: 'POST',
      body: { token: raw, turnstileToken: TURNSTILE_TOKEN },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      token: string;
      subject: { type: string; id: string };
      credentials: { loginEmail: string; pin: string };
    };
    expect(body.subject.type).toBe('guardian');
    expect(body.credentials.loginEmail).toBe(GUARDIAN_EMAIL);
    expect(body.credentials.pin).toMatch(/^\d{6}$/);
    guardianPin = body.credentials.pin;

    // The PIN is real: a fresh guardian login succeeds with it.
    const loginRes = await login('guardian', GUARDIAN_EMAIL, guardianPin);
    expect(loginRes.status).toBe(200);
  });

  it('runs the full consent ceremony across guardian and student', async () => {
    const guardianToken = await tokenOf('guardian', GUARDIAN_EMAIL, guardianPin);

    // Guardian sees the linked student, no access yet.
    const listRes = await callFunction('guardian-portal', { method: 'GET', bearer: guardianToken });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { students: { studentId: string; state: string }[] };
    expect(list.students.find((s) => s.studentId === studentId)?.state).toBe('none');

    // Ask to view — the code goes to the STUDENT, not the response.
    const reqRes = await callFunction('guardian-portal/request-access', {
      method: 'POST',
      bearer: guardianToken,
      body: { studentId },
    });
    expect(reqRes.status).toBe(201);
    const reqBody = (await reqRes.json()) as Record<string, unknown>;
    expect('code' in reqBody).toBe(false);
    expect('consentCode' in reqBody).toBe(false);

    // Without the grant, the student view is refused and audited.
    const early = await callFunction(`guardian-portal/student?studentId=${studentId}`, {
      method: 'GET',
      bearer: guardianToken,
    });
    expect(early.status).toBe(403);

    // The student sees the request + code in her app.
    const studentToken = await tokenOf('student', studentCode, studentPin);
    const noticeRes = await callFunction('student-guardian-requests', {
      method: 'GET',
      bearer: studentToken,
    });
    expect(noticeRes.status).toBe(200);
    const notice = (await noticeRes.json()) as {
      requests: { guardianName: string; code: string }[];
    };
    expect(notice.requests).toHaveLength(1);
    expect(notice.requests[0]?.guardianName).toBe('Rae Portal');
    const code = String(notice.requests[0]?.code);
    expect(code).toMatch(/^\d{6}$/);

    // A wrong code is refused and audited; the right one opens the window.
    const wrong = await callFunction('guardian-portal/enter-code', {
      method: 'POST',
      bearer: guardianToken,
      body: { studentId, code: code === '000000' ? '000001' : '000000' },
    });
    expect(wrong.status).toBe(401);

    const right = await callFunction('guardian-portal/enter-code', {
      method: 'POST',
      bearer: guardianToken,
      body: { studentId, code },
    });
    expect(right.status).toBe(200);
    expect(((await right.json()) as { state?: string }).state).toBe('active');

    // Grant open: the view returns profile + trend, and NEVER note text.
    await callFunction('crown-check', {
      method: 'POST',
      bearer: studentToken,
      body: { moodScore: 4, moodEmoji: '😊', note: 'private thoughts' },
    });
    const view = await callFunction(`guardian-portal/student?studentId=${studentId}`, {
      method: 'GET',
      bearer: guardianToken,
    });
    expect(view.status).toBe(200);
    const viewBody = (await view.json()) as {
      student: { displayName: string };
      trend: Record<string, unknown>[];
    };
    expect(viewBody.student.displayName).toBe('Maya');
    expect(viewBody.trend.length).toBeGreaterThanOrEqual(1);
    for (const point of viewBody.trend) {
      expect('note' in point).toBe(false);
    }
    const rawView = JSON.stringify(viewBody);
    expect(rawView.includes('private thoughts')).toBe(false);

    // The used code is gone from the student's app.
    const afterRes = await callFunction('student-guardian-requests', {
      method: 'GET',
      bearer: studentToken,
    });
    const after = (await afterRes.json()) as { requests: unknown[] };
    expect(after.requests).toHaveLength(0);

    // Audit trail: the guardian's read of student data is on record.
    const audits = await restSelect(
      'audit_logs',
      `actor_type=eq.guardian&entity_type=eq.student&entity_id=eq.${studentId}&outcome=eq.allowed&select=metadata`,
    );
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it('closes the window on expiry', async () => {
    const guardianToken = await tokenOf('guardian', GUARDIAN_EMAIL, guardianPin);
    await restUpdate('guardian_access_requests', `student_id=eq.${studentId}&status=eq.approved`, {
      access_expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    const res = await callFunction(`guardian-portal/student?studentId=${studentId}`, {
      method: 'GET',
      bearer: guardianToken,
    });
    expect(res.status).toBe(403);
  });

  it('grants emergency access invisibly to the student, fully audited', async () => {
    const granted = await callFunction('admin-students/emergency-access', {
      method: 'POST',
      bearer: superToken,
      body: { studentId },
    });
    expect(granted.status).toBe(201);

    // Guardian can view without any ceremony…
    const guardianToken = await tokenOf('guardian', GUARDIAN_EMAIL, guardianPin);
    const view = await callFunction(`guardian-portal/student?studentId=${studentId}`, {
      method: 'GET',
      bearer: guardianToken,
    });
    expect(view.status).toBe(200);

    // …and the STUDENT sees nothing at all.
    const studentToken = await tokenOf('student', studentCode, studentPin);
    const noticeRes = await callFunction('student-guardian-requests', {
      method: 'GET',
      bearer: studentToken,
    });
    const notice = (await noticeRes.json()) as { requests: unknown[] };
    expect(notice.requests).toHaveLength(0);

    // The audit log carries the emergency grant and the emergency-path read.
    const grants = await restSelect(
      'audit_logs',
      `actor_id=eq.${superId}&entity_type=eq.guardian_access_request&outcome=eq.allowed&order=created_at.desc&limit=1`,
    );
    expect(grants).toHaveLength(1);
    const reads = await restSelect(
      'audit_logs',
      `actor_type=eq.guardian&entity_type=eq.student&entity_id=eq.${studentId}&outcome=eq.allowed&order=created_at.desc&limit=1`,
    );
    expect(String((reads[0]?.metadata as Record<string, unknown> | null)?.via)).toBe(
      'emergency_grant',
    );
  });

  it('denies a student session on the guardian portal (403)', async () => {
    const studentToken = await tokenOf('student', studentCode, studentPin);
    const res = await callFunction('guardian-portal', { method: 'GET', bearer: studentToken });
    expect(res.status).toBe(403);
  });

  it('denies a guardian on admin endpoints and blocks guardian passkey registration', async () => {
    const guardianToken = await tokenOf('guardian', GUARDIAN_EMAIL, guardianPin);
    const admin = await callFunction('admin-dashboard', { method: 'GET', bearer: guardianToken });
    expect(admin.status).toBe(403);
    const webauthn = await callFunction('auth-webauthn-register/options', {
      method: 'POST',
      bearer: guardianToken,
    });
    expect(webauthn.status).toBe(403);
  });

  it('rejects a missing token with 401', async () => {
    const res = await callFunction('guardian-portal', { method: 'GET' });
    expect(res.status).toBe(401);
  });
});
