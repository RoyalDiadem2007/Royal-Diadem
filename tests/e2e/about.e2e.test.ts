/**
 * END-TO-END About Us tests (Phase 12) — no mocks. Real HTTP → the real
 * admin-about Edge Function → real Postgres, plus the anon Data API read
 * the public page uses.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anonKey, callFunction, restDelete, restSelect, restInsert, API_URL } from './stack.ts';

// bcrypt(12) of '123456' — fixture PIN for the E2E accounts (local stack only).
const PIN_HASH_123456 = '$2b$12$6dESXMU6poUgaUoSTSce.ezSDJsy6vs4Pn4Ho5DFPOxoaxxXpRjMq';
const PIN = '123456';
const TURNSTILE_TOKEN = 'e2e-test-token-XXXX.DUMMY.TOKEN.XXXX';

const SUPER_EMAIL = 'e2e-ab-super@example.com';
const MENTOR_EMAIL = 'e2e-ab-mentor@example.com';
const MARK = 'rd-e2eab';

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
  // about_content rows are singletons per section — remove only fixtures.
  await restDelete('about_content', `title=like.${MARK}%`);
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
    { name: 'About Super', role: 'super_admin', pin_hash: PIN_HASH_123456, email: SUPER_EMAIL },
    { name: 'About Mentor', role: 'mentor', pin_hash: PIN_HASH_123456, email: MENTOR_EMAIL },
  ]);
  superToken = await login(SUPER_EMAIL);
  mentorToken = await login(MENTOR_EMAIL);
});

afterAll(cleanup);

describe('admin-about Edge Function (E2E, no mocks)', () => {
  it('publishes a section, edits it in place, and anon reads it', async () => {
    const publish = await callFunction('admin-about/update', {
      method: 'POST',
      bearer: superToken,
      body: { section: 'pastor_bio', title: `${MARK} Pastor Kenecia`, body: 'Founder.' },
    });
    expect(publish.status).toBe(200);

    // Upsert, not insert: saving again replaces the same singleton row.
    const revise = await callFunction('admin-about/update', {
      method: 'POST',
      bearer: superToken,
      body: { section: 'pastor_bio', title: `${MARK} Pastor Kenecia`, body: 'Founder & shepherd.' },
    });
    expect(revise.status).toBe(200);
    const rows = await restSelect('about_content', `section=eq.pastor_bio&select=title,body`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toBe('Founder & shepherd.');

    // The public page's exact read path.
    const anonHeaders = { apikey: anonKey(), Authorization: `Bearer ${anonKey()}` };
    const read = await fetch(`${API_URL}/rest/v1/about_content?select=section,title,body`, {
      headers: anonHeaders,
    });
    expect(read.status).toBe(200);
    const anonRows = (await read.json()) as { section: string; body: string }[];
    expect(
      anonRows.some((r) => r.section === 'pastor_bio' && r.body === 'Founder & shepherd.'),
    ).toBe(true);

    // Anon never writes the About page.
    const forge = await fetch(`${API_URL}/rest/v1/about_content`, {
      method: 'POST',
      headers: { ...anonHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: 'about_org', title: `${MARK} forged`, body: 'x' }),
    });
    expect([401, 403]).toContain(forge.status);
  });

  it('denies mentors and anonymous callers', async () => {
    const body = { section: 'about_org', title: `${MARK} nope`, body: 'x' };
    const asMentor = await callFunction('admin-about/update', {
      method: 'POST',
      bearer: mentorToken,
      body,
    });
    expect(asMentor.status).toBe(403);
    const asNobody = await callFunction('admin-about/update', { method: 'POST', body });
    expect(asNobody.status).toBe(401);
  });
});
