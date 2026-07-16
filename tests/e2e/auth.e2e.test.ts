/**
 * END-TO-END auth tests — no mocks anywhere. Real HTTP → real Edge Functions
 * (auth-login/auth-session/auth-logout) → real Postgres (bcrypt hashes, the
 * atomic rate limiter, the sessions table, the append-only audit log).
 *
 * Turnstile uses Cloudflare's official always-pass TEST secret, so the
 * verification round-trip to Cloudflare is real; only the challenge outcome
 * is fixed. That is the one true external boundary in the suite.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callFunction, restDelete, restInsert, restSelect, API_URL } from './stack.ts';

// bcrypt(12) of '123456' — fixture PIN for the E2E accounts (local stack only).
const PIN_HASH_123456 = '$2b$12$6dESXMU6poUgaUoSTSce.ezSDJsy6vs4Pn4Ho5DFPOxoaxxXpRjMq';
const PIN = '123456';
const WRONG_PIN = '999999';
// Any token passes with the Turnstile test secret; length must satisfy the schema.
const TURNSTILE_TOKEN = 'e2e-test-token-XXXX.DUMMY.TOKEN.XXXX';

const STUDENT_ACTIVE_CODE = 'rd-e2e-active';
const STUDENT_COPPA_CODE = 'rd-e2e-coppa';
const STUDENT_LOCKOUT_CODE = 'rd-e2e-lockout';
const ADMIN_EMAIL = 'e2e-mentor@example.com';

let activeStudentId = '';

async function loginRequest(
  subjectType: 'student' | 'admin',
  identifier: string,
  pin: string,
): Promise<Response> {
  return callFunction('auth-login', {
    method: 'POST',
    body: { subjectType, identifier, pin, turnstileToken: TURNSTILE_TOKEN },
  });
}

async function cleanup(): Promise<void> {
  await restDelete('sessions', 'subject_id=neq.00000000-0000-0000-0000-000000000000');
  await restDelete('auth_rate_limits', 'limit_key=like.login%');
  await restDelete('students', `login_code=like.rd-e2e-%`);
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

  const students = await restInsert('students', [
    {
      first_name: 'Ava',
      last_name: 'Example',
      display_name: 'Ava',
      date_of_birth: '2011-05-01',
      pin_hash: PIN_HASH_123456,
      login_code: STUDENT_ACTIVE_CODE,
      status: 'active',
      coppa_required: false,
      coppa_consent_status: 'verified',
    },
    {
      first_name: 'Zoe',
      last_name: 'Example',
      display_name: 'Zoe',
      date_of_birth: '2014-09-15',
      pin_hash: PIN_HASH_123456,
      login_code: STUDENT_COPPA_CODE,
      status: 'active',
      coppa_required: true,
      coppa_consent_status: 'pending',
    },
    {
      first_name: 'Mia',
      last_name: 'Example',
      display_name: 'Mia',
      date_of_birth: '2010-01-20',
      pin_hash: PIN_HASH_123456,
      login_code: STUDENT_LOCKOUT_CODE,
      status: 'active',
      coppa_required: false,
      coppa_consent_status: 'verified',
    },
  ]);
  const seededId = students[0]?.id;
  if (typeof seededId !== 'string' || seededId === '') {
    throw new Error('seeding students failed');
  }
  activeStudentId = seededId;

  await restInsert('admin_users', [
    {
      name: 'E2E Mentor',
      role: 'mentor',
      email: ADMIN_EMAIL,
      pin_hash: PIN_HASH_123456,
    },
  ]);
});

afterAll(async () => {
  await cleanup();
});

describe('auth end-to-end (real stack)', () => {
  it('logs a student in with crown code + PIN and returns a session', async () => {
    const res = await loginRequest('student', STUDENT_ACTIVE_CODE, PIN);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      token?: string;
      expiresAt?: string;
      subject?: { type?: string; id?: string; displayName?: string; role?: string };
    };
    expect(typeof body.token).toBe('string');
    expect((body.token ?? '').length).toBeGreaterThanOrEqual(40);
    expect(body.subject?.displayName).toBe('Ava');
    expect(body.subject?.role).toBe('student');

    // The session row exists with a HASH of the token — never the raw token.
    const sessions = await restSelect('sessions', `subject_id=eq.${activeStudentId}`);
    expect(sessions.length).toBe(1);
    expect(sessions[0]?.token_hash).not.toBe(body.token);

    // The audit trail recorded the allowed login.
    const audits = await restSelect(
      'audit_logs',
      `entity_id=eq.${activeStudentId}&action=eq.login&outcome=eq.allowed`,
    );
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects a wrong PIN with a generic code and audits the denial', async () => {
    const res = await loginRequest('student', STUDENT_ACTIVE_CODE, WRONG_PIN);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('invalid_credentials');

    const audits = await restSelect(
      'audit_logs',
      `entity_id=eq.${activeStudentId}&action=eq.login&outcome=eq.denied`,
    );
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects an unknown crown code identically to a wrong PIN (no account oracle)', async () => {
    const res = await loginRequest('student', 'rd-e2e-does-not-exist', PIN);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('invalid_credentials');
  });

  it('blocks an under-13 student until guardian consent is verified (COPPA gate)', async () => {
    const res = await loginRequest('student', STUDENT_COPPA_CODE, PIN);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('consent_pending');
  });

  it('logs an admin in by email and reports the mentor role', async () => {
    const res = await loginRequest('admin', ADMIN_EMAIL, PIN);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { subject?: { role?: string; type?: string } };
    expect(body.subject?.type).toBe('admin');
    expect(body.subject?.role).toBe('mentor');
  });

  it('validates, refreshes, and revokes a real session across functions', async () => {
    const loginRes = await loginRequest('student', STUDENT_ACTIVE_CODE, PIN);
    expect(loginRes.status).toBe(200);
    const { token } = (await loginRes.json()) as { token: string };

    const sessionRes = await callFunction('auth-session', { method: 'GET', bearer: token });
    expect(sessionRes.status).toBe(200);
    const sessionBody = (await sessionRes.json()) as { subject?: { id?: string } };
    expect(sessionBody.subject?.id).toBe(activeStudentId);

    const logoutRes = await callFunction('auth-logout', { method: 'POST', bearer: token });
    expect(logoutRes.status).toBe(204);

    // Revoked means revoked: the same token is dead immediately.
    const afterLogout = await callFunction('auth-session', { method: 'GET', bearer: token });
    expect(afterLogout.status).toBe(401);
  });

  it('rejects garbage tokens and missing tokens on the session endpoint', async () => {
    const missing = await callFunction('auth-session', { method: 'GET' });
    expect(missing.status).toBe(401);

    const garbage = await callFunction('auth-session', { method: 'GET', bearer: 'not-a-token' });
    expect(garbage.status).toBe(401);
  });

  it('locks an identifier after 5 failed attempts with Retry-After (runs last)', async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const res = await loginRequest('student', STUDENT_LOCKOUT_CODE, WRONG_PIN);
      expect(res.status).toBe(401);
    }

    const sixth = await loginRequest('student', STUDENT_LOCKOUT_CODE, WRONG_PIN);
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers.get('retry-after'))).toBeGreaterThan(0);
    const body = (await sixth.json()) as { error?: string };
    expect(body.error).toBe('too_many_attempts');

    // Even the CORRECT pin is refused while locked out.
    const correctWhileLocked = await loginRequest('student', STUDENT_LOCKOUT_CODE, PIN);
    expect(correctWhileLocked.status).toBe(429);
  });
});
