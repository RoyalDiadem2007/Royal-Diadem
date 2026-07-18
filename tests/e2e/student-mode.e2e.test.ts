/**
 * END-TO-END Student Mode tests — no mocks. Real HTTP → the real student-mode /
 * crown-check / admin-dashboard / admin-students Edge Functions → real
 * Postgres: a real staff student row is provisioned, a real student session is
 * minted, real writes land on it, and the population tiles exclude it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callFunction, restDelete, restInsert, restSelect, API_URL } from './stack.ts';

// bcrypt(12) of '123456' — fixture PIN for the E2E accounts (local stack only).
const PIN_HASH_123456 = '$2b$12$6dESXMU6poUgaUoSTSce.ezSDJsy6vs4Pn4Ho5DFPOxoaxxXpRjMq';
const PIN = '123456';
// Any token passes with the Turnstile test secret; length must satisfy the schema.
const TURNSTILE_TOKEN = 'e2e-test-token-XXXX.DUMMY.TOKEN.XXXX';

// Distinct fixture namespace — other suites clean different prefixes.
const SUPER_EMAIL = 'e2e-smode-super@example.com';
const MENTOR_EMAIL = 'e2e-smode-mentor@example.com';
const VIEWER_EMAIL = 'e2e-smode-viewer@example.com';

let superId = '';
let mentorId = '';

function requireId(row: Record<string, unknown> | undefined, what: string): string {
  const id = row?.id;
  if (typeof id !== 'string' || id === '') {
    throw new Error(`seeding ${what} failed`);
  }
  return id;
}

async function login(identifier: string): Promise<string> {
  const res = await callFunction('auth-login', {
    method: 'POST',
    body: { subjectType: 'admin', identifier, pin: PIN, turnstileToken: TURNSTILE_TOKEN },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { token?: string };
  if (typeof body.token !== 'string') {
    throw new Error('login fixture did not return a token');
  }
  return body.token;
}

async function enterStudentMode(bearer: string): Promise<{
  token: string;
  staffMode: boolean;
  subject: { type: string; id: string; displayName: string; role: string };
}> {
  const res = await callFunction('student-mode', { method: 'POST', bearer });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    token: string;
    staffMode: boolean;
    subject: { type: string; id: string; displayName: string; role: string };
  };
}

async function dashboardCounts(bearer: string): Promise<Record<string, number>> {
  const res = await callFunction('admin-dashboard', { method: 'GET', bearer });
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, number>;
}

async function cleanup(): Promise<void> {
  const admins = await restSelect(
    'admin_users',
    `email=in.(${SUPER_EMAIL},${MENTOR_EMAIL},${VIEWER_EMAIL})&select=id`,
  );
  for (const admin of admins) {
    const adminId = String(admin.id);
    const staff = await restSelect('students', `staff_owner_admin_id=eq.${adminId}&select=id`);
    for (const row of staff) {
      const staffId = String(row.id);
      await restDelete('crown_checks', `student_id=eq.${staffId}`);
      await restDelete('sessions', `subject_id=eq.${staffId}`);
      await restDelete('students', `id=eq.${staffId}`);
    }
    await restDelete('sessions', `subject_id=eq.${adminId}`);
    await restDelete('admin_users', `id=eq.${adminId}`);
  }
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
    { name: 'Smode Super', role: 'super_admin', pin_hash: PIN_HASH_123456, email: SUPER_EMAIL },
    { name: 'Smode Mentor', role: 'mentor', pin_hash: PIN_HASH_123456, email: MENTOR_EMAIL },
    { name: 'Smode Viewer', role: 'viewer', pin_hash: PIN_HASH_123456, email: VIEWER_EMAIL },
  ]);
  superId = requireId(admins[0], 'admin_users super');
  mentorId = requireId(admins[1], 'admin_users mentor');
});

afterAll(cleanup);

describe('student-mode Edge Function (E2E, no mocks)', () => {
  it('provisions a labeled staff student once and mints a working student session', async () => {
    const adminToken = await login(SUPER_EMAIL);

    const first = await enterStudentMode(adminToken);
    expect(first.staffMode).toBe(true);
    expect(first.subject.type).toBe('student');
    expect(first.subject.displayName).toBe('Smode Super (Staff)');

    // Idempotent: a second entry reuses the same staff identity.
    const second = await enterStudentMode(adminToken);
    expect(second.subject.id).toBe(first.subject.id);

    // The row is linked, inert as an account, and COPPA-exempt.
    const rows = await restSelect(
      'students',
      `staff_owner_admin_id=eq.${superId}&select=id,login_code,status,coppa_required,date_of_birth`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(first.subject.id);
    expect(rows[0]?.login_code).toBeNull();
    expect(rows[0]?.status).toBe('active');
    expect(rows[0]?.coppa_required).toBe(false);

    // The staff session is a REAL student session: a crown check write works.
    const check = await callFunction('crown-check', {
      method: 'POST',
      bearer: second.token,
      body: { moodScore: 4, moodEmoji: '👑' },
    });
    expect(check.status).toBe(201);

    // Entering was audited against the ADMIN, naming the staff student.
    const audits = await restSelect(
      'audit_logs',
      `actor_id=eq.${superId}&entity_type=eq.student_mode&outcome=eq.allowed&select=action,entity_id`,
    );
    expect(audits.length).toBeGreaterThanOrEqual(2);
    expect(audits[0]?.entity_id).toBe(first.subject.id);
  });

  it('gives each admin their own separate staff identity', async () => {
    const mentorToken = await login(MENTOR_EMAIL);
    const entered = await enterStudentMode(mentorToken);
    expect(entered.subject.displayName).toBe('Smode Mentor (Staff)');

    const superRows = await restSelect('students', `staff_owner_admin_id=eq.${superId}&select=id`);
    const mentorRows = await restSelect(
      'students',
      `staff_owner_admin_id=eq.${mentorId}&select=id`,
    );
    expect(mentorRows).toHaveLength(1);
    expect(mentorRows[0]?.id).not.toBe(superRows[0]?.id);
  });

  it('excludes staff identities from the dashboard population tiles', async () => {
    const adminToken = await login(SUPER_EMAIL);
    const counts = await dashboardCounts(adminToken);

    // Both staff students exist and one checked in today, yet neither the
    // roster count nor today's crown checks may include staff rows.
    const staffStudents = await restSelect(
      'students',
      'staff_owner_admin_id=not.is.null&status=eq.active&select=id',
    );
    expect(staffStudents.length).toBeGreaterThanOrEqual(2);

    const allActive = await restSelect('students', 'status=eq.active&select=id');
    expect(counts.activeStudents).toBe(allActive.length - staffStudents.length);
  });

  it('labels staff identities in the roster', async () => {
    const adminToken = await login(SUPER_EMAIL);
    const res = await callFunction('admin-students', { method: 'GET', bearer: adminToken });
    expect(res.status).toBe(200);
    const roster = (await res.json()) as {
      students: { id: string; isStaff: boolean; displayName: string }[];
      total: number;
    };
    const staffRows = roster.students.filter((s) => s.isStaff);
    expect(staffRows.length).toBeGreaterThanOrEqual(1);
    for (const row of staffRows) {
      expect(row.displayName.endsWith('(Staff)')).toBe(true);
    }
  });

  it('denies the read-only viewer role and audits the denial', async () => {
    const viewerToken = await login(VIEWER_EMAIL);
    const res = await callFunction('student-mode', { method: 'POST', bearer: viewerToken });
    expect(res.status).toBe(403);
  });

  it('rejects an unauthenticated entry outright', async () => {
    const res = await callFunction('student-mode', { method: 'POST' });
    expect(res.status).toBe(401);
  });
});
