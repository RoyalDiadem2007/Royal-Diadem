/**
 * END-TO-END Relaxation library tests (Phase 11) — no mocks. Real HTTP →
 * the real admin-relaxation Edge Function → real Postgres, plus the anon
 * Data API path the Relax room uses (RLS: active rows only; no anon
 * writes).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anonKey, callFunction, restDelete, restInsert, restSelect, API_URL } from './stack.ts';

// bcrypt(12) of '123456' — fixture PIN for the E2E accounts (local stack only).
const PIN_HASH_123456 = '$2b$12$6dESXMU6poUgaUoSTSce.ezSDJsy6vs4Pn4Ho5DFPOxoaxxXpRjMq';
const PIN = '123456';
const TURNSTILE_TOKEN = 'e2e-test-token-XXXX.DUMMY.TOKEN.XXXX';

const SUPER_EMAIL = 'e2e-rx-super@example.com';
const MENTOR_EMAIL = 'e2e-rx-mentor@example.com';
const STUDENT_CODE = 'rd-e2erx-a';
const MARK = 'rd-e2erx';

let superToken = '';
let mentorToken = '';
let studentToken = '';

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

async function anonRest(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('apikey', anonKey());
  headers.set('Authorization', `Bearer ${anonKey()}`);
  return fetch(`${API_URL}/rest/v1/${path}`, { ...init, headers });
}

async function cleanup(): Promise<void> {
  await restDelete('relaxation_content', `title=like.${MARK}%`);
  const students = await restSelect('students', 'login_code=like.rd-e2erx-%&select=id');
  if (students.length > 0) {
    await restDelete('sessions', `subject_id=in.(${students.map((s) => String(s.id)).join(',')})`);
  }
  const admins = await restSelect(
    'admin_users',
    `email=in.(${SUPER_EMAIL},${MENTOR_EMAIL})&select=id`,
  );
  if (admins.length > 0) {
    await restDelete('sessions', `subject_id=in.(${admins.map((a) => String(a.id)).join(',')})`);
  }
  await restDelete('auth_rate_limits', 'limit_key=like.login%');
  await restDelete('students', 'login_code=like.rd-e2erx-%');
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

  await restInsert('admin_users', [
    { name: 'Relax Super', role: 'super_admin', pin_hash: PIN_HASH_123456, email: SUPER_EMAIL },
    { name: 'Relax Mentor', role: 'mentor', pin_hash: PIN_HASH_123456, email: MENTOR_EMAIL },
  ]);
  await restInsert('students', [
    {
      first_name: 'Grace',
      last_name: 'Relax',
      display_name: 'Grace',
      date_of_birth: '2011-03-01',
      pin_hash: PIN_HASH_123456,
      login_code: STUDENT_CODE,
      status: 'active',
      coppa_required: false,
      coppa_consent_status: 'verified',
    },
  ]);

  superToken = await login('admin', SUPER_EMAIL);
  mentorToken = await login('admin', MENTOR_EMAIL);
  studentToken = await login('student', STUDENT_CODE);
});

afterAll(cleanup);

describe('admin-relaxation Edge Function (E2E, no mocks)', () => {
  let itemId = '';

  it('creates, lists, retires and deletes library items, audit-logged', async () => {
    const create = await callFunction('admin-relaxation/create', {
      method: 'POST',
      bearer: superToken,
      body: { kind: 'scripture', title: `${MARK} Psalm 46:10`, body: 'Be still, and know.' },
    });
    expect(create.status).toBe(201);
    const created = ((await create.json()) as { item: { id: string; active: boolean } }).item;
    expect(created.active).toBe(true);
    itemId = created.id;

    const audits = await restSelect(
      'audit_logs',
      `entity_id=eq.${itemId}&entity_type=eq.relaxation_content&action=eq.create&select=outcome`,
    );
    expect(audits).toHaveLength(1);

    const list = await callFunction('admin-relaxation?page=1', {
      method: 'GET',
      bearer: superToken,
    });
    expect(list.status).toBe(200);
    const items = ((await list.json()) as { items: { id: string }[] }).items;
    expect(items.some((i) => i.id === itemId)).toBe(true);

    const retire = await callFunction('admin-relaxation/update', {
      method: 'POST',
      bearer: superToken,
      body: {
        itemId,
        kind: 'scripture',
        title: `${MARK} Psalm 46:10`,
        body: 'Be still, and know.',
        active: false,
        sortOrder: 3,
      },
    });
    expect(retire.status).toBe(200);
    const retired = ((await retire.json()) as { item: { active: boolean; sortOrder: number } })
      .item;
    expect(retired.active).toBe(false);
    expect(retired.sortOrder).toBe(3);
  });

  it('serves anon only ACTIVE rows and denies anon writes', async () => {
    await restInsert('relaxation_content', [
      {
        kind: 'affirmation',
        title: `${MARK} You are chosen`,
        body: 'Crowned on purpose.',
        active: true,
        created_by: (await restSelect('admin_users', `email=eq.${SUPER_EMAIL}&select=id`)).map(
          (a) => String(a.id),
        )[0],
      },
    ]);

    const read = await anonRest(`relaxation_content?title=like.${MARK}%25&select=title,active`);
    expect(read.status).toBe(200);
    const rows = (await read.json()) as { title: string; active: boolean }[];
    // The retired Psalm from the previous test is invisible; the active
    // affirmation is served.
    expect(rows.some((r) => r.title === `${MARK} You are chosen`)).toBe(true);
    expect(rows.every((r) => r.active)).toBe(true);
    expect(rows.some((r) => r.title === `${MARK} Psalm 46:10`)).toBe(false);

    const write = await anonRest('relaxation_content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'affirmation', title: `${MARK} forged`, body: 'x' }),
    });
    expect([401, 403]).toContain(write.status);
  });

  it('denies mentors, students and anonymous callers on curation', async () => {
    const body = { kind: 'affirmation', title: `${MARK} nope`, body: 'x' };
    const asMentor = await callFunction('admin-relaxation/create', {
      method: 'POST',
      bearer: mentorToken,
      body,
    });
    expect(asMentor.status).toBe(403);
    const asStudent = await callFunction('admin-relaxation/create', {
      method: 'POST',
      bearer: studentToken,
      body,
    });
    expect(asStudent.status).toBe(403);
    const asNobody = await callFunction('admin-relaxation/create', { method: 'POST', body });
    expect(asNobody.status).toBe(401);
  });

  it('deletes an item for real', async () => {
    const del = await callFunction('admin-relaxation/delete', {
      method: 'POST',
      bearer: superToken,
      body: { itemId },
    });
    expect(del.status).toBe(200);
    expect(await restSelect('relaxation_content', `id=eq.${itemId}&select=id`)).toHaveLength(0);
  });
});
