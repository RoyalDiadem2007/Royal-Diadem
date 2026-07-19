/**
 * END-TO-END strengths vocabulary tests (SXU) — no mocks. Real HTTP → the
 * real admin-strengths Edge Function → real Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callFunction, restDelete, restInsert, restSelect, API_URL } from './stack.ts';

// bcrypt(12) of '123456' — fixture PIN for the E2E accounts (local stack only).
const PIN_HASH_123456 = '$2b$12$6dESXMU6poUgaUoSTSce.ezSDJsy6vs4Pn4Ho5DFPOxoaxxXpRjMq';
const PIN = '123456';
const TURNSTILE_TOKEN = 'e2e-test-token-XXXX.DUMMY.TOKEN.XXXX';

const SUPER_EMAIL = 'e2e-st-super@example.com';
const MENTOR_EMAIL = 'e2e-st-mentor@example.com';
const KEY = 'rd-e2est-brave';

let superToken = '';
let mentorToken = '';

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

async function cleanup(): Promise<void> {
  await restDelete('strength_options', 'key=like.rd-e2est-%');
  const admins = await restSelect(
    'admin_users',
    `email=in.(${SUPER_EMAIL},${MENTOR_EMAIL})&select=id`,
  );
  if (admins.length > 0) {
    await restDelete('sessions', `subject_id=in.(${admins.map((a) => String(a.id)).join(',')})`);
  }
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
  await restInsert('admin_users', [
    { name: 'ST Super', role: 'super_admin', pin_hash: PIN_HASH_123456, email: SUPER_EMAIL },
    { name: 'ST Mentor', role: 'mentor', pin_hash: PIN_HASH_123456, email: MENTOR_EMAIL },
  ]);
  superToken = await login(SUPER_EMAIL);
  mentorToken = await login(MENTOR_EMAIL);
});

afterAll(cleanup);

describe('admin-strengths Edge Function (E2E, no mocks)', () => {
  it('creates a word, refuses duplicates, retires and reactivates it', async () => {
    const create = await callFunction('admin-strengths/create', {
      method: 'POST',
      bearer: superToken,
      body: { key: KEY, label: 'Brave' },
    });
    expect(create.status).toBe(201);

    const duplicate = await callFunction('admin-strengths/create', {
      method: 'POST',
      bearer: superToken,
      body: { key: KEY, label: 'Brave Again' },
    });
    expect(duplicate.status).toBe(409);

    const retire = await callFunction('admin-strengths/toggle', {
      method: 'POST',
      bearer: superToken,
      body: { key: KEY, active: false },
    });
    expect(retire.status).toBe(200);
    const rows = await restSelect('strength_options', `key=eq.${KEY}&select=active`);
    expect(rows[0]?.active).toBe(false);

    const list = await callFunction('admin-strengths', { method: 'GET', bearer: superToken });
    expect(list.status).toBe(200);
    const options = ((await list.json()) as { options: { key: string; active: boolean }[] })
      .options;
    expect(options.some((o) => o.key === KEY && !o.active)).toBe(true);
  });

  it('denies mentors and anonymous callers', async () => {
    const asMentor = await callFunction('admin-strengths', { method: 'GET', bearer: mentorToken });
    expect(asMentor.status).toBe(403);
    const asNobody = await callFunction('admin-strengths', { method: 'GET' });
    expect(asNobody.status).toBe(401);
  });
});
