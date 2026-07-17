/**
 * END-TO-END admin-students tests — no mocks. The strongest assertion here is
 * the full credential circle: enroll through the Edge Function, then LOG IN as
 * that student with the returned crown code + PIN through the real auth
 * pipeline (bcrypt, rate limiter, sessions). Reset does the same circle again
 * and proves the old PIN and old session are both dead.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callFunction, restDelete, restInsert, restSelect, API_URL } from './stack.ts';

// bcrypt(12) of '123456' — fixture PIN for the E2E admin accounts (local stack only).
const PIN_HASH_123456 = '$2b$12$6dESXMU6poUgaUoSTSce.ezSDJsy6vs4Pn4Ho5DFPOxoaxxXpRjMq';
const ADMIN_PIN = '123456';
const TURNSTILE_TOKEN = 'e2e-test-token-XXXX.DUMMY.TOKEN.XXXX';

const SUPER_EMAIL = 'e2e-enroll-super@example.com';
const MENTOR_EMAIL = 'e2e-enroll-mentor@example.com';
// Distinct from other suites' fixtures ('rd-e2e-%', 'rd-e2edash-%').
const LAST_NAME = 'E2eEnroll';

let superAdminId = '';
let mentorId = '';

async function loginAdmin(email: string): Promise<string> {
  const res = await callFunction('auth-login', {
    method: 'POST',
    body: {
      subjectType: 'admin',
      identifier: email,
      pin: ADMIN_PIN,
      turnstileToken: TURNSTILE_TOKEN,
    },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { token?: string };
  if (typeof body.token !== 'string') {
    throw new Error('admin login fixture did not return a token');
  }
  return body.token;
}

async function loginStudent(loginCode: string, pin: string): Promise<Response> {
  return callFunction('auth-login', {
    method: 'POST',
    body: { subjectType: 'student', identifier: loginCode, pin, turnstileToken: TURNSTILE_TOKEN },
  });
}

async function cleanup(): Promise<void> {
  const students = await restSelect('students', `last_name=eq.${LAST_NAME}&select=id`);
  const ids = students.map((s) => String(s.id));
  if (ids.length > 0) {
    await restDelete('sessions', `subject_id=in.(${ids.join(',')})`);
  }
  const admins = await restSelect(
    'admin_users',
    `email=in.(${SUPER_EMAIL},${MENTOR_EMAIL})&select=id`,
  );
  if (admins.length > 0) {
    await restDelete('sessions', `subject_id=in.(${admins.map((a) => String(a.id)).join(',')})`);
  }
  await restDelete('auth_rate_limits', 'limit_key=like.login%');
  await restDelete('students', `last_name=eq.${LAST_NAME}`);
  await restDelete('admin_users', `email=in.(${SUPER_EMAIL},${MENTOR_EMAIL})`);
}

function requireId(row: Record<string, unknown> | undefined, what: string): string {
  const id = row?.id;
  if (typeof id !== 'string' || id === '') {
    throw new Error(`seeding ${what} failed`);
  }
  return id;
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
    { name: 'Enroll Super', role: 'super_admin', pin_hash: PIN_HASH_123456, email: SUPER_EMAIL },
    { name: 'Enroll Mentor', role: 'mentor', pin_hash: PIN_HASH_123456, email: MENTOR_EMAIL },
  ]);
  superAdminId = requireId(admins[0], 'super admin');
  mentorId = requireId(admins[1], 'mentor');
});

afterAll(cleanup);

describe('admin-students Edge Function (E2E, no mocks)', () => {
  it('enrolls a student whose generated credentials really log in, and audits the create', async () => {
    const token = await loginAdmin(SUPER_EMAIL);

    const res = await callFunction('admin-students/create', {
      method: 'POST',
      bearer: token,
      body: {
        firstName: 'Naomi',
        lastName: LAST_NAME,
        displayName: 'Naomi',
        dateOfBirth: '2011-03-05', // 15 at enrollment → no COPPA gate
        phase: 'Phase 1',
      },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      student: {
        id: string;
        loginCode: string;
        coppaRequired: boolean;
        coppaConsentStatus: string;
      };
      pin: string;
    };
    expect(body.pin).toMatch(/^\d{6}$/);
    expect(body.student.loginCode).toMatch(/^[A-Z0-9]+-[2-9A-HJ-KM-NP-Z]{4}$/);
    expect(body.student.coppaRequired).toBe(false);

    // The credential circle: those exact credentials work in the real login.
    const studentLogin = await loginStudent(body.student.loginCode, body.pin);
    expect(studentLogin.status).toBe(200);

    const audits = await restSelect(
      'audit_logs',
      `actor_id=eq.${superAdminId}&entity_type=eq.student&action=eq.create&outcome=eq.allowed&order=created_at.desc&limit=1`,
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.entity_id).toBe(body.student.id);
  });

  it('marks an under-13 enrollee COPPA-required and her login stays consent-gated', async () => {
    const token = await loginAdmin(SUPER_EMAIL);

    const res = await callFunction('admin-students/create', {
      method: 'POST',
      bearer: token,
      body: {
        firstName: 'Perla',
        lastName: LAST_NAME,
        displayName: 'Perla',
        dateOfBirth: '2015-11-20', // 10 at enrollment → COPPA gate applies
      },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      student: { loginCode: string; coppaRequired: boolean; coppaConsentStatus: string };
      pin: string;
    };
    expect(body.student.coppaRequired).toBe(true);
    expect(body.student.coppaConsentStatus).toBe('pending');

    // Correct credentials, but the COPPA gate holds until consent is verified.
    const studentLogin = await loginStudent(body.student.loginCode, body.pin);
    expect(studentLogin.status).toBe(403);
    const denied = (await studentLogin.json()) as { error?: string };
    expect(denied.error).toBe('consent_pending');
  });

  it('lists the roster with pagination metadata', async () => {
    const token = await loginAdmin(SUPER_EMAIL);

    const res = await callFunction('admin-students?page=1', { method: 'GET', bearer: token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      students: { lastName: string }[];
      page: number;
      pageSize: number;
      total: number;
    };
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(50);
    expect(body.total).toBeGreaterThanOrEqual(2);
    expect(body.students.some((s) => s.lastName === LAST_NAME)).toBe(true);
  });

  it('resets a PIN: old PIN dead, old session revoked, new PIN logs in, audit written', async () => {
    const adminToken = await loginAdmin(SUPER_EMAIL);

    const created = await callFunction('admin-students/create', {
      method: 'POST',
      bearer: adminToken,
      body: {
        firstName: 'Talia',
        lastName: LAST_NAME,
        displayName: 'Talia',
        dateOfBirth: '2010-06-30',
      },
    });
    expect(created.status).toBe(201);
    const enrolled = (await created.json()) as {
      student: { id: string; loginCode: string };
      pin: string;
    };

    const firstLogin = await loginStudent(enrolled.student.loginCode, enrolled.pin);
    expect(firstLogin.status).toBe(200);
    const firstSession = (await firstLogin.json()) as { token: string };

    const reset = await callFunction('admin-students/reset-pin', {
      method: 'POST',
      bearer: adminToken,
      body: { studentId: enrolled.student.id },
    });
    expect(reset.status).toBe(200);
    const resetBody = (await reset.json()) as { pin: string };
    expect(resetBody.pin).toMatch(/^\d{6}$/);

    // Old session is revoked immediately (§17.2).
    const oldSession = await callFunction('auth-session', {
      method: 'GET',
      bearer: firstSession.token,
    });
    expect(oldSession.status).toBe(401);

    // Old PIN no longer works; the new one does.
    const oldPinLogin = await loginStudent(enrolled.student.loginCode, enrolled.pin);
    expect(oldPinLogin.status).toBe(401);
    const newPinLogin = await loginStudent(enrolled.student.loginCode, resetBody.pin);
    expect(newPinLogin.status).toBe(200);

    const audits = await restSelect(
      'audit_logs',
      `actor_id=eq.${superAdminId}&entity_type=eq.student&action=eq.update&entity_id=eq.${enrolled.student.id}&order=created_at.desc&limit=1`,
    );
    expect(audits).toHaveLength(1);
    expect((audits[0]?.metadata as { operation?: string }).operation).toBe('pin_reset');
  });

  it('denies a mentor with 403 and audits the denial (least privilege until OD-6)', async () => {
    const token = await loginAdmin(MENTOR_EMAIL);

    const res = await callFunction('admin-students?page=1', { method: 'GET', bearer: token });
    expect(res.status).toBe(403);

    const audits = await restSelect(
      'audit_logs',
      `actor_id=eq.${mentorId}&entity_type=eq.student&outcome=eq.denied&order=created_at.desc&limit=1`,
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actor_role).toBe('mentor');
  });

  it('imports a CSV chunk with per-row results; imported credentials really log in', async () => {
    const token = await loginAdmin(SUPER_EMAIL);
    const row = (first: string, dob: string) => ({
      firstName: first,
      lastName: LAST_NAME,
      displayName: first,
      dateOfBirth: dob,
    });

    // The same girl twice in one file: first row enrolls, second is refused
    // as a duplicate (re-running an import can't double-enroll, §7).
    const res = await callFunction('admin-students/import', {
      method: 'POST',
      bearer: token,
      body: {
        rows: [row('Imelda', '2012-04-14'), row('Imelda', '2012-04-14'), row('Iris', '2010-05-05')],
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: (
        | { index: number; ok: true; student: { loginCode: string }; pin: string }
        | { index: number; ok: false; reason: string }
      )[];
    };
    expect(body.results).toHaveLength(3);
    const [first, second, third] = body.results;
    if (first?.ok !== true || third?.ok !== true) {
      throw new Error('expected rows 0 and 2 to enroll');
    }
    expect(second).toEqual({ index: 1, ok: false, reason: 'duplicate' });

    const login = await loginStudent(third.student.loginCode, third.pin);
    expect(login.status).toBe(200);

    const audits = await restSelect(
      'audit_logs',
      `actor_id=eq.${superAdminId}&entity_type=eq.student&action=eq.create&metadata->>via=eq.csv_import&order=created_at.desc&limit=2`,
    );
    expect(audits).toHaveLength(2);
  });

  it('rejects an oversized import chunk with 400 (client must slice)', async () => {
    const token = await loginAdmin(SUPER_EMAIL);
    const rows = Array.from({ length: 11 }, (_, i) => ({
      firstName: `Bulk${String(i)}`,
      lastName: LAST_NAME,
      displayName: `Bulk${String(i)}`,
      dateOfBirth: '2012-01-01',
    }));
    const res = await callFunction('admin-students/import', {
      method: 'POST',
      bearer: token,
      body: { rows },
    });
    expect(res.status).toBe(400);
  });

  it('rejects malformed enrollment bodies with 400', async () => {
    const token = await loginAdmin(SUPER_EMAIL);
    const res = await callFunction('admin-students/create', {
      method: 'POST',
      bearer: token,
      body: { firstName: 'X', lastName: 'Y', displayName: 'Z', dateOfBirth: '2030-01-01' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for a PIN reset on an unknown student', async () => {
    const token = await loginAdmin(SUPER_EMAIL);
    const res = await callFunction('admin-students/reset-pin', {
      method: 'POST',
      bearer: token,
      body: { studentId: '00000000-0000-0000-0000-000000000000' },
    });
    expect(res.status).toBe(404);
  });

  it('rejects a missing token with 401', async () => {
    const res = await callFunction('admin-students?page=1', { method: 'GET' });
    expect(res.status).toBe(401);
  });
});
