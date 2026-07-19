/**
 * END-TO-END admin-dashboard tests — no mocks. Real HTTP → the real Edge
 * Function → real Postgres: real sessions table, real RBAC role lookup, real
 * counts, real append-only audit rows (allowed AND denied).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callFunction, restDelete, restInsert, restSelect, restUpdate, API_URL } from './stack.ts';

// bcrypt(12) of '123456' — fixture PIN for the E2E accounts (local stack only).
const PIN_HASH_123456 = '$2b$12$6dESXMU6poUgaUoSTSce.ezSDJsy6vs4Pn4Ho5DFPOxoaxxXpRjMq';
const PIN = '123456';
// Any token passes with the Turnstile test secret; length must satisfy the schema.
const TURNSTILE_TOKEN = 'e2e-test-token-XXXX.DUMMY.TOKEN.XXXX';

// Distinct fixtures — auth.e2e cleans up 'rd-e2e-%', these deliberately don't match it.
const STUDENT_CODE_A = 'rd-e2edash-a';
const STUDENT_CODE_B = 'rd-e2edash-b';
const STUDENT_CODE_INACTIVE = 'rd-e2edash-off';
const ADMIN_EMAIL = 'e2e-dash-admin@example.com';

let adminId = '';
let studentAId = '';

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

/**
 * Id-independent cleanup so it also repairs leftovers from an interrupted
 * earlier run. Flags are append-only by design (no DELETE grant — safety
 * history is permanent), so seeded flags are resolved, never deleted.
 */
async function cleanup(): Promise<void> {
  const students = await restSelect('students', 'login_code=like.rd-e2edash-%&select=id');
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
  const admins = await restSelect('admin_users', `email=eq.${ADMIN_EMAIL}&select=id`);
  if (admins.length > 0) {
    await restDelete('sessions', `subject_id=in.(${admins.map((a) => String(a.id)).join(',')})`);
  }
  await restDelete('auth_rate_limits', 'limit_key=like.login%');
  await restDelete('students', 'login_code=like.rd-e2edash-%');
  await restDelete('admin_users', `email=eq.${ADMIN_EMAIL}`);
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
    { name: 'Dash Mentor', role: 'mentor', pin_hash: PIN_HASH_123456, email: ADMIN_EMAIL },
  ]);
  adminId = requireId(admins[0], 'admin_users');

  const students = await restInsert('students', [
    {
      first_name: 'Amber',
      last_name: 'Dash',
      display_name: 'Amber',
      date_of_birth: '2011-02-01',
      pin_hash: PIN_HASH_123456,
      login_code: STUDENT_CODE_A,
      status: 'active',
      coppa_required: false,
      coppa_consent_status: 'verified',
    },
    {
      first_name: 'Brianna',
      last_name: 'Dash',
      display_name: 'Brianna',
      date_of_birth: '2012-03-02',
      pin_hash: PIN_HASH_123456,
      login_code: STUDENT_CODE_B,
      status: 'active',
      coppa_required: false,
      coppa_consent_status: 'verified',
    },
    {
      first_name: 'Cara',
      last_name: 'Dash',
      display_name: 'Cara',
      date_of_birth: '2010-04-03',
      pin_hash: PIN_HASH_123456,
      login_code: STUDENT_CODE_INACTIVE,
      status: 'inactive',
      coppa_required: false,
      coppa_consent_status: 'verified',
    },
  ]);
  studentAId = requireId(students[0], 'students');

  const checks = await restInsert('crown_checks', [
    { student_id: studentAId, mood_score: 4, mood_emoji: '😊' },
  ]);
  const checkId = requireId(checks[0], 'crown_checks');

  await restInsert('flags', [
    { source: 'ai', entity_type: 'crown_check', entity_id: checkId, severity: 'high' },
    { source: 'ai', entity_type: 'crown_check', entity_id: checkId, severity: 'medium' },
  ]);
});

afterAll(cleanup);

describe('admin-dashboard Edge Function (E2E, no mocks)', () => {
  it('returns real aggregate counts to a signed-in admin and audits the read', async () => {
    const token = await login('admin', ADMIN_EMAIL);

    const res = await callFunction('admin-dashboard', { method: 'GET', bearer: token });
    expect(res.status).toBe(200);
    const counts = (await res.json()) as Record<string, number>;

    // Other suites share the database, so assert floors, not exact totals.
    expect(counts.activeStudents).toBeGreaterThanOrEqual(2);
    expect(counts.newFlags).toBeGreaterThanOrEqual(2);
    expect(counts.highSeverityNewFlags).toBeGreaterThanOrEqual(1);
    expect(counts.todaysCrownChecks).toBeGreaterThanOrEqual(1);

    // The pending-work strip (SXU): every counter present and sane.
    const pending = (counts as unknown as { pending: Record<string, number> }).pending;
    for (const key of [
      'openFlags',
      'moderation',
      'guardianRequests',
      'encouragementDrafts',
      'upcomingEvents',
    ]) {
      expect(pending[key]).toBeGreaterThanOrEqual(0);
    }
    expect(pending.openFlags).toBeGreaterThanOrEqual(counts.newFlags ?? 0);
    for (const key of ['activeStudents', 'newFlags', 'highSeverityNewFlags', 'todaysCrownChecks']) {
      expect(typeof counts[key]).toBe('number');
    }

    const audits = await restSelect(
      'audit_logs',
      `actor_id=eq.${adminId}&entity_type=eq.admin_dashboard&outcome=eq.allowed&order=created_at.desc&limit=1`,
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe('read');
    expect(audits[0]?.actor_role).toBe('mentor');
  });

  it('denies a student session with 403 and audits the denied attempt', async () => {
    const token = await login('student', STUDENT_CODE_A);

    const res = await callFunction('admin-dashboard', { method: 'GET', bearer: token });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('forbidden');

    const audits = await restSelect(
      'audit_logs',
      `actor_id=eq.${studentAId}&entity_type=eq.admin_dashboard&outcome=eq.denied&order=created_at.desc&limit=1`,
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actor_type).toBe('student');
  });

  it('rejects a missing token with 401', async () => {
    const res = await callFunction('admin-dashboard', { method: 'GET' });
    expect(res.status).toBe(401);
  });

  it('rejects a garbage token with 401 (invalid session)', async () => {
    const res = await callFunction('admin-dashboard', {
      method: 'GET',
      bearer: 'not-a-real-token',
    });
    expect(res.status).toBe(401);
  });

  it('rejects non-GET methods with 405', async () => {
    const token = await login('admin', ADMIN_EMAIL);
    const res = await callFunction('admin-dashboard', { method: 'POST', bearer: token, body: {} });
    expect(res.status).toBe(405);
  });
});
