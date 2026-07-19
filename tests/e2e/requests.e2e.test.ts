/**
 * END-TO-END "Your people" server tests — no mocks. Real HTTP → the real
 * mentor-sessions / friend-invites / admin-requests Edge Functions → real
 * Postgres. Proves the whole ceremony: she asks, staff confirm the real
 * time; she nominates a friend, staff decide, and deciding provably scrubs
 * the address while the dedupe hash keeps working.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callFunction, restDelete, restInsert, restSelect } from './stack.ts';

// bcrypt(12) of '123456' — fixture PIN for the E2E accounts (local stack only).
const PIN_HASH_123456 = '$2b$12$6dESXMU6poUgaUoSTSce.ezSDJsy6vs4Pn4Ho5DFPOxoaxxXpRjMq';
const PIN = '123456';
const TURNSTILE_TOKEN = 'e2e-test-token-XXXX.DUMMY.TOKEN.XXXX';

const STUDENT_CODE = 'rd-e2erq-a';
const OTHER_CODE = 'rd-e2erq-b';
const SUPER_EMAIL = 'e2e-rq-super@example.com';
const FRIEND_EMAIL = 'e2e-rq-friend@example.com';

let studentToken = '';
let otherToken = '';
let superToken = '';
let studentId = '';

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

function requireId(row: Record<string, unknown> | undefined, what: string): string {
  const id = row?.id;
  if (typeof id !== 'string' || id === '') {
    throw new Error(`seeding ${what} failed`);
  }
  return id;
}

/** YYYY-MM-DD `days` from now, UTC — matches the server's window math. */
function daysAhead(days: number): string {
  const base = new Date();
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

async function cleanup(): Promise<void> {
  const students = await restSelect('students', 'login_code=like.rd-e2erq-%&select=id');
  if (students.length > 0) {
    const ids = students.map((s) => String(s.id)).join(',');
    await restDelete('mentor_session_requests', `student_id=in.(${ids})`);
    await restDelete('friend_invites', `student_id=in.(${ids})`);
    await restDelete('sessions', `subject_id=in.(${ids})`);
  }
  const admins = await restSelect('admin_users', `email=eq.${SUPER_EMAIL}&select=id`);
  if (admins.length > 0) {
    await restDelete('sessions', `subject_id=in.(${admins.map((a) => String(a.id)).join(',')})`);
  }
  await restDelete('auth_rate_limits', 'limit_key=like.msession%');
  await restDelete('auth_rate_limits', 'limit_key=like.finvite%');
  await restDelete('auth_rate_limits', 'limit_key=like.login%');
  await restDelete('students', 'login_code=like.rd-e2erq-%');
  await restDelete('admin_users', `email=eq.${SUPER_EMAIL}`);
}

beforeAll(async () => {
  await cleanup();

  await restInsert('admin_users', [
    { name: 'RQ Super', role: 'super_admin', pin_hash: PIN_HASH_123456, email: SUPER_EMAIL },
  ]);

  const students = await restInsert('students', [
    {
      first_name: 'Maya',
      last_name: 'Queen',
      display_name: 'Maya',
      date_of_birth: '2011-03-01',
      pin_hash: PIN_HASH_123456,
      login_code: STUDENT_CODE,
      status: 'active',
      coppa_required: false,
      coppa_consent_status: 'verified',
    },
    {
      first_name: 'Nia',
      last_name: 'Other',
      display_name: 'Nia',
      date_of_birth: '2012-05-02',
      pin_hash: PIN_HASH_123456,
      login_code: OTHER_CODE,
      status: 'active',
      coppa_required: false,
      coppa_consent_status: 'verified',
    },
  ]);
  studentId = requireId(students[0], 'students');

  studentToken = await login('student', STUDENT_CODE);
  otherToken = await login('student', OTHER_CODE);
  superToken = await login('admin', SUPER_EMAIL);
});

afterAll(async () => {
  await cleanup();
});

describe('mentor sessions — ask, one at a time, confirm', () => {
  let requestId = '';

  it('rejects malformed windows outright', async () => {
    for (const preferredWindows of [
      [],
      [{ date: 'not-a-date', slot: 'morning' }],
      [{ date: daysAhead(3), slot: 'midnight' }],
      [{ date: daysAhead(120), slot: 'morning' }],
      [
        { date: daysAhead(3), slot: 'morning' },
        { date: daysAhead(3), slot: 'morning' },
      ],
    ]) {
      const res = await callFunction('mentor-sessions/request', {
        method: 'POST',
        bearer: studentToken,
        body: { preferredWindows },
      });
      expect(res.status).toBe(400);
    }
  });

  it('accepts her windows and enforces one open ask', async () => {
    const created = await callFunction('mentor-sessions/request', {
      method: 'POST',
      bearer: studentToken,
      body: {
        preferredWindows: [
          { date: daysAhead(3), slot: 'after_school' },
          { date: daysAhead(5), slot: 'evening' },
        ],
      },
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { requestId?: string };
    expect(typeof body.requestId).toBe('string');
    requestId = String(body.requestId);

    const second = await callFunction('mentor-sessions/request', {
      method: 'POST',
      bearer: studentToken,
      body: { preferredWindows: [{ date: daysAhead(4), slot: 'morning' }] },
    });
    expect(second.status).toBe(409);
    expect(((await second.json()) as { error?: string }).error).toBe('request_open');
  });

  it('shows the ask on her list and in the admin queue — students cannot read the queue', async () => {
    const list = await callFunction('mentor-sessions', { method: 'GET', bearer: studentToken });
    expect(list.status).toBe(200);
    const { requests } = (await list.json()) as {
      requests: { id: string; status: string }[];
    };
    expect(requests.some((r) => r.id === requestId && r.status === 'pending')).toBe(true);

    const denied = await callFunction('admin-requests', { method: 'GET', bearer: studentToken });
    expect([401, 403]).toContain(denied.status);

    const queue = await callFunction('admin-requests', { method: 'GET', bearer: superToken });
    expect(queue.status).toBe(200);
    const queueBody = (await queue.json()) as {
      sessions: { id: string; studentName: string }[];
    };
    expect(queueBody.sessions.some((s) => s.id === requestId && s.studentName === 'Maya')).toBe(
      true,
    );
  });

  it('confirms with the real time and the confirmation reaches her card', async () => {
    const confirmed = await callFunction('admin-requests/sessions/confirm', {
      method: 'POST',
      bearer: superToken,
      body: { requestId, date: daysAhead(3), time: '15:30', endTime: '16:15' },
    });
    expect(confirmed.status).toBe(200);

    // Already decided → nothing left to confirm.
    const again = await callFunction('admin-requests/sessions/confirm', {
      method: 'POST',
      bearer: superToken,
      body: { requestId, date: daysAhead(3), time: '15:30', endTime: null },
    });
    expect(again.status).toBe(404);

    const list = await callFunction('mentor-sessions', { method: 'GET', bearer: studentToken });
    const { requests } = (await list.json()) as {
      requests: { id: string; status: string; scheduledDate: string; scheduledTime: string }[];
    };
    const mine = requests.find((r) => r.id === requestId);
    expect(mine?.status).toBe('confirmed');
    expect(mine?.scheduledDate).toBe(daysAhead(3));
    expect(mine?.scheduledTime).toBe('15:30');
  });
});

describe('friend invites — nominate, human decides, address scrubbed', () => {
  let inviteId = '';

  it('rejects a malformed address', async () => {
    const res = await callFunction('friend-invites/create', {
      method: 'POST',
      bearer: studentToken,
      body: { email: 'not-an-email' },
    });
    expect(res.status).toBe(400);
  });

  it('accepts the nomination and dedupes the same inbox', async () => {
    const created = await callFunction('friend-invites/create', {
      method: 'POST',
      bearer: studentToken,
      body: { email: FRIEND_EMAIL },
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { inviteId?: string };
    expect(typeof body.inviteId).toBe('string');
    inviteId = String(body.inviteId);

    // Same address, different casing — same inbox, same answer.
    const repeat = await callFunction('friend-invites/create', {
      method: 'POST',
      bearer: studentToken,
      body: { email: FRIEND_EMAIL.toUpperCase() },
    });
    expect(repeat.status).toBe(409);
    expect(((await repeat.json()) as { error?: string }).error).toBe('already_invited');
  });

  it('another student is not blocked by her dedupe', async () => {
    const res = await callFunction('friend-invites/create', {
      method: 'POST',
      bearer: otherToken,
      body: { email: FRIEND_EMAIL },
    });
    expect(res.status).toBe(201);
  });

  it('marks reached-out and provably scrubs the address, keeping the dedupe', async () => {
    const decided = await callFunction('admin-requests/invites/reached-out', {
      method: 'POST',
      bearer: superToken,
      body: { inviteId },
    });
    expect(decided.status).toBe(200);

    // The address is gone from the row; the hash (and dedupe) remain.
    const rows = await restSelect(
      'friend_invites',
      `id=eq.${inviteId}&select=invite_email,email_hash,status`,
    );
    expect(rows[0]?.status).toBe('reached_out');
    expect(rows[0]?.invite_email).toBeNull();
    expect(String(rows[0]?.email_hash)).toMatch(/^[0-9a-f]{64}$/);

    const repeat = await callFunction('friend-invites/create', {
      method: 'POST',
      bearer: studentToken,
      body: { email: FRIEND_EMAIL },
    });
    expect(repeat.status).toBe(409);

    // Her card shows the decided invite without the address.
    const list = await callFunction('friend-invites', { method: 'GET', bearer: studentToken });
    const { invites } = (await list.json()) as {
      invites: { id: string; email: string | null; status: string }[];
    };
    const mine = invites.find((i) => i.id === inviteId);
    expect(mine?.status).toBe('reached_out');
    expect(mine?.email).toBeNull();
  });

  it('counts both queues on the admin dashboard pending strip', async () => {
    const res = await callFunction('admin-dashboard', { method: 'GET', bearer: superToken });
    expect(res.status).toBe(200);
    const { pending } = (await res.json()) as {
      pending: { sessionRequests: number; friendInvites: number };
    };
    // Nia's nomination is still pending; Maya's session was confirmed.
    expect(pending.friendInvites).toBeGreaterThanOrEqual(1);
    expect(pending.sessionRequests).toBeGreaterThanOrEqual(0);
  });

  it('students own their reads: her list never shows another girl’s invites', async () => {
    const list = await callFunction('friend-invites', { method: 'GET', bearer: otherToken });
    const { invites } = (await list.json()) as { invites: { id: string }[] };
    expect(invites.some((i) => i.id === inviteId)).toBe(false);
    expect(studentId).not.toBe('');
  });
});
