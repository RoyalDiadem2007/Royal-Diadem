/**
 * END-TO-END Encouragement Engine tests (Phase 7, OD-18) — no mocks beyond
 * the env-gated canned AI transport (the Anthropic API is the one true
 * external boundary; the canned batch passes the same validator as live
 * output). Real drafts in Postgres, real status transitions, real
 * ai_corrections rows, real rules, real RBAC + audit.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callFunction, restDelete, restInsert, restSelect, API_URL } from './stack.ts';

const PIN_HASH_123456 = '$2b$12$6dESXMU6poUgaUoSTSce.ezSDJsy6vs4Pn4Ho5DFPOxoaxxXpRjMq';
const PIN = '123456';
const TURNSTILE_TOKEN = 'e2e-test-token-XXXX.DUMMY.TOKEN.XXXX';

const SUPER_EMAIL = 'e2e-en-super@example.com';
const MENTOR_EMAIL = 'e2e-en-mentor@example.com';
// A fixed far-future Monday so reruns and other suites never collide.
const WEEK = '2030-01-07';

let superId = '';
let superToken = '';

async function tokenOf(identifier: string): Promise<string> {
  const res = await callFunction('auth-login', {
    method: 'POST',
    body: { subjectType: 'admin', identifier, pin: PIN, turnstileToken: TURNSTILE_TOKEN },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { token?: string };
  if (typeof body.token !== 'string') {
    throw new Error('admin login fixture failed');
  }
  return body.token;
}

async function cleanup(): Promise<void> {
  const messages = await restSelect('encouragement_messages', `week_of=eq.${WEEK}&select=id`);
  if (messages.length > 0) {
    const ids = messages.map((m) => String(m.id));
    await restDelete('ai_corrections', `message_id=in.(${ids.join(',')})`);
    await restDelete('encouragement_messages', `id=in.(${ids.join(',')})`);
  }
  await restDelete('ai_rules', 'rule_text=like.rd-e2een%');
  const admins = await restSelect(
    'admin_users',
    `email=in.(${SUPER_EMAIL},${MENTOR_EMAIL})&select=id`,
  );
  if (admins.length > 0) {
    await restDelete('sessions', `subject_id=in.(${admins.map((a) => String(a.id)).join(',')})`);
  }
  await restDelete('auth_rate_limits', 'limit_key=eq.aigen:global');
  await restDelete('auth_rate_limits', 'limit_key=like.login%');
  await restDelete('admin_users', `email=in.(${SUPER_EMAIL},${MENTOR_EMAIL})`);
}

beforeAll(async () => {
  const reachable = await fetch(`${API_URL}/rest/v1/`, { method: 'HEAD' })
    .then((ping) => ping.status < 500)
    .catch(() => false);
  if (!reachable) {
    throw new Error(`Local Supabase stack is not reachable at ${API_URL}.`);
  }
  await cleanup();
  const admins = await restInsert('admin_users', [
    { name: 'EN Super', role: 'super_admin', pin_hash: PIN_HASH_123456, email: SUPER_EMAIL },
    { name: 'EN Mentor', role: 'mentor', pin_hash: PIN_HASH_123456, email: MENTOR_EMAIL },
  ]);
  const seededId = admins[0]?.id;
  if (typeof seededId !== 'string' || seededId === '') {
    throw new Error('seeding admin failed');
  }
  superId = seededId;
  superToken = await tokenOf(SUPER_EMAIL);
});

afterAll(cleanup);

describe('encouragement engine (E2E, canned gateway)', () => {
  let mondayDraftId = '';
  let tuesdayDraftId = '';
  let wednesdayDraftId = '';

  it('generates exactly 7 validated drafts mapped Monday-Sunday with metadata', async () => {
    const res = await callFunction('encouragement/generate', {
      method: 'POST',
      bearer: superToken,
      body: { weekOf: WEEK },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      messages: {
        id: string;
        text: string;
        scheduledDate: string;
        status: string;
        model: string;
      }[];
    };
    expect(body.messages).toHaveLength(7);
    expect(body.messages[0]?.scheduledDate).toBe('2030-01-07');
    expect(body.messages[6]?.scheduledDate).toBe('2030-01-13');
    for (const message of body.messages) {
      expect(message.status).toBe('draft');
      expect(message.text.length).toBeLessThanOrEqual(280);
      expect(message.model).toBe('canned');
    }
    mondayDraftId = String(body.messages[0]?.id);
    tuesdayDraftId = String(body.messages[1]?.id);
    wednesdayDraftId = String(body.messages[2]?.id);

    const rows = await restSelect(
      'encouragement_messages',
      `week_of=eq.${WEEK}&select=source,ai_generation_metadata`,
    );
    expect(rows).toHaveLength(7);
    expect(rows[0]?.source).toBe('ai_generated');
    const metadata = rows[0]?.ai_generation_metadata as Record<string, unknown>;
    expect(metadata.promptVersion).toBe('encouragement-v1');

    const audits = await restSelect(
      'audit_logs',
      `actor_id=eq.${superId}&entity_type=eq.encouragement_message&action=eq.create&outcome=eq.allowed&limit=1`,
    );
    expect(audits).toHaveLength(1);
  });

  it('rejects non-Monday weeks with 400', async () => {
    const res = await callFunction('encouragement/generate', {
      method: 'POST',
      bearer: superToken,
      body: { weekOf: '2030-01-08' },
    });
    expect(res.status).toBe(400);
  });

  it('approves a draft; rejecting records a correction with the reason', async () => {
    const approved = await callFunction('encouragement/approve', {
      method: 'POST',
      bearer: superToken,
      body: { messageId: mondayDraftId },
    });
    expect(approved.status).toBe(200);

    const rejected = await callFunction('encouragement/reject', {
      method: 'POST',
      bearer: superToken,
      body: { messageId: tuesdayDraftId, reason: 'rd-e2een: tone off for Tuesday' },
    });
    expect(rejected.status).toBe(200);

    const corrections = await restSelect(
      'ai_corrections',
      `message_id=eq.${tuesdayDraftId}&select=original_text,corrected_text,reason,model,prompt_version,reviewed_by`,
    );
    expect(corrections).toHaveLength(1);
    expect(corrections[0]?.corrected_text).toBeNull();
    expect(corrections[0]?.reason).toBe('rd-e2een: tone off for Tuesday');
    expect(corrections[0]?.model).toBe('canned');
    expect(corrections[0]?.prompt_version).toBe('encouragement-v1');
    expect(corrections[0]?.reviewed_by).toBe(superId);
  });

  it('replace: her words land approved, the AI draft dies with a correction', async () => {
    const res = await callFunction('encouragement/replace', {
      method: 'POST',
      bearer: superToken,
      body: {
        messageId: wednesdayDraftId,
        text: 'Midweek, queen: you have already survived every hard Wednesday so far. Undefeated.',
        reason: 'rd-e2een: wanted my own voice midweek',
      },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { message: { source: string; status: string } };
    expect(body.message.source).toBe('admin_written');
    expect(body.message.status).toBe('approved');

    const original = await restSelect(
      'encouragement_messages',
      `id=eq.${wednesdayDraftId}&select=status`,
    );
    expect(original[0]?.status).toBe('rejected');

    const corrections = await restSelect(
      'ai_corrections',
      `message_id=eq.${wednesdayDraftId}&select=corrected_text`,
    );
    expect(String(corrections[0]?.corrected_text)).toContain('Undefeated');
  });

  it('posts only approved messages and stamps who posted', async () => {
    const res = await callFunction('encouragement/post', {
      method: 'POST',
      bearer: superToken,
      body: { weekOf: WEEK },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { posted: number }).posted).toBe(2); // Monday + replacement

    const posted = await restSelect(
      'encouragement_messages',
      `week_of=eq.${WEEK}&status=eq.posted&select=posted_by,posted_at`,
    );
    expect(posted).toHaveLength(2);
    expect(posted[0]?.posted_by).toBe(superId);
    expect(posted[0]?.posted_at).not.toBeNull();

    // Drafts are untouched; a second post with nothing newly approved is 409.
    const again = await callFunction('encouragement/post', {
      method: 'POST',
      bearer: superToken,
      body: { weekOf: WEEK },
    });
    expect(again.status).toBe(409);
  });

  it('regeneration replaces only unreviewed drafts, never history', async () => {
    const res = await callFunction('encouragement/generate', {
      method: 'POST',
      bearer: superToken,
      body: { weekOf: WEEK },
    });
    expect(res.status).toBe(201);

    const rows = await restSelect('encouragement_messages', `week_of=eq.${WEEK}&select=status`);
    const byStatus = new Map<string, number>();
    for (const row of rows) {
      const status = String(row.status);
      byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
    }
    expect(byStatus.get('draft')).toBe(7); // the fresh batch
    expect(byStatus.get('posted')).toBe(2); // untouched history
    expect(byStatus.get('rejected')).toBe(6); // 2 explicit + 4 replaced drafts
  });

  it('human-approved rules are stored and toggleable', async () => {
    const created = await callFunction('encouragement/rules', {
      method: 'POST',
      bearer: superToken,
      body: { text: 'rd-e2een: never mention specific denominations' },
    });
    expect(created.status).toBe(201);
    const ruleId = ((await created.json()) as { rule: { id: string } }).rule.id;

    const list = await callFunction('encouragement/rules', { method: 'GET', bearer: superToken });
    const rules = ((await list.json()) as { rules: { id: string; active: boolean }[] }).rules;
    expect(rules.some((r) => r.id === ruleId && r.active)).toBe(true);

    const toggled = await callFunction('encouragement/rules/toggle', {
      method: 'POST',
      bearer: superToken,
      body: { ruleId, active: false },
    });
    expect(toggled.status).toBe(200);
  });

  it('denies mentors, students-of-any-kind, and anonymous callers', async () => {
    const mentorToken = await tokenOf(MENTOR_EMAIL);
    expect(
      (
        await callFunction('encouragement/generate', {
          method: 'POST',
          bearer: mentorToken,
          body: { weekOf: WEEK },
        })
      ).status,
    ).toBe(403);
    expect((await callFunction(`encouragement?weekOf=${WEEK}`, { method: 'GET' })).status).toBe(
      401,
    );
  });
});
