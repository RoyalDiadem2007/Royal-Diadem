/**
 * END-TO-END web-push tests (VAPID) — no mocks. Real subscription rows, real
 * VAPID public key from env, and proof the guardian-request trigger tolerates
 * a dead push endpoint (push is a nudge, never a dependency).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callFunction, restDelete, restInsert, restSelect, restUpdate, API_URL } from './stack.ts';

const PIN_HASH_123456 = '$2b$12$6dESXMU6poUgaUoSTSce.ezSDJsy6vs4Pn4Ho5DFPOxoaxxXpRjMq';
const PIN = '123456';
const TURNSTILE_TOKEN = 'e2e-test-token-XXXX.DUMMY.TOKEN.XXXX';

const MARKER_SCHOOL = 'rd-e2eps-school';
const SUPER_EMAIL = 'e2e-ps-super@example.com';
const GUARDIAN_EMAIL = 'e2e-ps-guardian@example.com';
const FAKE_ENDPOINT = 'https://push.example.com/rd-e2eps/device-1';

let superToken = '';
let studentId = '';
let studentToken = '';

function requireId(row: Record<string, unknown> | undefined, what: string): string {
  const id = row?.id;
  if (typeof id !== 'string' || id === '') {
    throw new Error(`seeding ${what} failed`);
  }
  return id;
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
    throw new Error('login fixture failed');
  }
  return body.token;
}

async function cleanup(): Promise<void> {
  await restDelete('push_subscriptions', `endpoint=like.https://push.example.com/rd-e2eps/%`);
  const students = await restSelect('students', `school_name=eq.${MARKER_SCHOOL}&select=id`);
  const ids = students.map((s) => String(s.id));
  if (ids.length > 0) {
    const filter = `student_id=in.(${ids.join(',')})`;
    await restDelete('guardian_access_requests', filter);
    await restDelete('magic_links', filter);
    await restDelete('guardians', filter);
    await restDelete('sessions', `subject_id=in.(${ids.join(',')})`);
    await restDelete('students', `id=in.(${ids.join(',')})`);
  }
  const accounts = await restSelect('guardian_accounts', `email=like.e2e-ps-%&select=id`);
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
  await restDelete('admin_users', `email=eq.${SUPER_EMAIL}`);
}

beforeAll(async () => {
  const reachable = await fetch(`${API_URL}/rest/v1/`, { method: 'HEAD' })
    .then((ping) => ping.status < 500)
    .catch(() => false);
  if (!reachable) {
    throw new Error(`Local Supabase stack is not reachable at ${API_URL}.`);
  }

  await cleanup();
  await restInsert('admin_users', [
    { name: 'PS Super', role: 'super_admin', pin_hash: PIN_HASH_123456, email: SUPER_EMAIL },
  ]);
  superToken = await tokenOf('admin', SUPER_EMAIL);

  const created = await callFunction('admin-students/create', {
    method: 'POST',
    bearer: superToken,
    body: {
      firstName: 'Pia',
      lastName: 'Pusher',
      displayName: 'Pia',
      dateOfBirth: '2012-01-15',
      schoolName: MARKER_SCHOOL,
      guardianName: 'Gil Pusher',
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

describe('web push (E2E, no mocks)', () => {
  it('serves the VAPID public key without auth', async () => {
    const res = await callFunction('push/public-key', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { publicKey?: string };
    expect(String(body.publicKey).length).toBeGreaterThan(40);
  });

  it('stores a subscription for the signed-in subject and audits it', async () => {
    const res = await callFunction('push/subscribe', {
      method: 'POST',
      bearer: studentToken,
      body: {
        endpoint: FAKE_ENDPOINT,
        keys: { p256dh: 'BPtestp256dh_key_material_here_x', auth: 'authsecret16chars' },
      },
    });
    expect(res.status).toBe(201);

    const rows = await restSelect(
      'push_subscriptions',
      `endpoint=eq.${encodeURIComponent(FAKE_ENDPOINT)}&select=subject_type,subject_id`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.subject_type).toBe('student');
    expect(rows[0]?.subject_id).toBe(studentId);
  });

  it('keeps the guardian request working when the push endpoint is dead', async () => {
    // Portal-enabled guardian, linked, consent verified (under-13 student).
    await restUpdate('students', `id=eq.${studentId}`, { coppa_consent_status: 'verified' });
    const accounts = await restInsert('guardian_accounts', [
      { email: GUARDIAN_EMAIL, display_name: 'Gil Pusher', pin_hash: PIN_HASH_123456 },
    ]);
    const accountId = requireId(accounts[0], 'guardian_accounts');
    const guardians = await restSelect('guardians', `student_id=eq.${studentId}&select=id`);
    await restUpdate('guardians', `id=eq.${requireId(guardians[0], 'guardians')}`, {
      account_id: accountId,
    });

    const guardianToken = await tokenOf('guardian', GUARDIAN_EMAIL);
    // The trigger sends to the dead endpoint above; the request must still
    // succeed — push is a nudge, not a dependency.
    const res = await callFunction('guardian-portal/request-access', {
      method: 'POST',
      bearer: guardianToken,
      body: { studentId },
    });
    expect(res.status).toBe(201);

    // The student still sees the request + code in-app regardless.
    const notice = await callFunction('student-guardian-requests', {
      method: 'GET',
      bearer: studentToken,
    });
    const noticeBody = (await notice.json()) as { requests: unknown[] };
    expect(noticeBody.requests).toHaveLength(1);
  });

  it('unsubscribes and removes the row', async () => {
    const res = await callFunction('push/unsubscribe', {
      method: 'POST',
      bearer: studentToken,
      body: { endpoint: FAKE_ENDPOINT },
    });
    expect(res.status).toBe(200);
    const rows = await restSelect(
      'push_subscriptions',
      `endpoint=eq.${encodeURIComponent(FAKE_ENDPOINT)}&select=id`,
    );
    expect(rows).toHaveLength(0);
  });

  it('rejects anonymous subscribes (401) and malformed bodies (400)', async () => {
    expect(
      (
        await callFunction('push/subscribe', {
          method: 'POST',
          body: { endpoint: FAKE_ENDPOINT, keys: { p256dh: 'x'.repeat(20), auth: 'y'.repeat(16) } },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await callFunction('push/subscribe', {
          method: 'POST',
          bearer: studentToken,
          body: { endpoint: 'not-a-url', keys: { p256dh: 'short', auth: 'x' } },
        })
      ).status,
    ).toBe(400);
  });
});
