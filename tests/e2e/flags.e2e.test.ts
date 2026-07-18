/**
 * END-TO-END Flag Center tests (Phase 14) — no mocks. Real HTTP → the real
 * admin-flags Edge Function → real Postgres: real flag rows with real
 * entity context, real status transitions, real RBAC and audit.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callFunction, restDelete, restInsert, restSelect, restUpdate, API_URL } from './stack.ts';

// bcrypt(12) of '123456' — fixture PIN for the E2E accounts (local stack only).
const PIN_HASH_123456 = '$2b$12$6dESXMU6poUgaUoSTSce.ezSDJsy6vs4Pn4Ho5DFPOxoaxxXpRjMq';
const PIN = '123456';
const TURNSTILE_TOKEN = 'e2e-test-token-XXXX.DUMMY.TOKEN.XXXX';

const SUPER_EMAIL = 'e2e-fl-super@example.com';
const MENTOR_EMAIL = 'e2e-fl-mentor@example.com';
const STUDENT_CODE = 'rd-e2efl-a';
const PEER_CODE = 'rd-e2efl-b';

let superToken = '';
let mentorToken = '';
let studentToken = '';
let studentId = '';
let peerId = '';
let checkId = '';
let checkFlagId = '';
let postFlagId = '';

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

async function cleanup(): Promise<void> {
  const students = await restSelect('students', 'login_code=like.rd-e2efl-%&select=id');
  if (students.length > 0) {
    const ids = students.map((s) => String(s.id)).join(',');
    const checks = await restSelect('crown_checks', `student_id=in.(${ids})&select=id`);
    const posts = await restSelect('share_posts', `student_id=in.(${ids})&select=id`);
    const entityIds = [...checks, ...posts].map((r) => String(r.id));
    if (entityIds.length > 0) {
      // Flags are append-only; resolve and detach fixture references.
      await restUpdate('flags', `entity_id=in.(${entityIds.join(',')})`, { status: 'resolved' });
    }
    await restUpdate('flags', `flagged_by=in.(${ids})`, { flagged_by: null });
    if (checks.length > 0) {
      await restDelete('crown_checks', `student_id=in.(${ids})`);
    }
    if (posts.length > 0) {
      await restDelete('share_posts', `student_id=in.(${ids})`);
    }
    await restDelete('sessions', `subject_id=in.(${ids})`);
  }
  const admins = await restSelect(
    'admin_users',
    `email=in.(${SUPER_EMAIL},${MENTOR_EMAIL})&select=id`,
  );
  if (admins.length > 0) {
    const adminIds = admins.map((a) => String(a.id)).join(',');
    await restDelete('sessions', `subject_id=in.(${adminIds})`);
    await restUpdate('flags', `reviewed_by=in.(${adminIds})`, { reviewed_by: null });
  }
  await restDelete('auth_rate_limits', 'limit_key=like.login%');
  await restDelete('students', 'login_code=like.rd-e2efl-%');
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
    { name: 'Flags Super', role: 'super_admin', pin_hash: PIN_HASH_123456, email: SUPER_EMAIL },
    { name: 'Flags Mentor', role: 'mentor', pin_hash: PIN_HASH_123456, email: MENTOR_EMAIL },
  ]);
  const students = await restInsert('students', [
    {
      first_name: 'Amber',
      last_name: 'Flagged',
      display_name: 'Amber',
      date_of_birth: '2011-03-01',
      pin_hash: PIN_HASH_123456,
      login_code: STUDENT_CODE,
      status: 'active',
      coppa_required: false,
      coppa_consent_status: 'verified',
    },
    {
      first_name: 'Nia',
      last_name: 'Peer',
      display_name: 'Nia',
      date_of_birth: '2012-05-02',
      pin_hash: PIN_HASH_123456,
      login_code: PEER_CODE,
      status: 'active',
      coppa_required: false,
      coppa_consent_status: 'verified',
    },
  ]);
  studentId = requireId(students[0], 'students');
  peerId = requireId(students[1], 'students');

  // A flagged crown check (AI) and a peer-flagged share post — real rows,
  // exactly as the product functions write them.
  const checks = await restInsert('crown_checks', [
    {
      student_id: studentId,
      check_date: '2030-06-03',
      mood_score: 1,
      mood_emoji: '🌧️',
      ai_flag_triggered: true,
      ai_flag_reason: '3 consecutive check-ins at or below 2',
    },
  ]);
  checkId = requireId(checks[0], 'crown_checks');
  const checkFlags = await restInsert('flags', [
    { source: 'ai', entity_type: 'crown_check', entity_id: checkId, severity: 'high' },
  ]);
  checkFlagId = requireId(checkFlags[0], 'flags');

  const posts = await restInsert('share_posts', [
    {
      student_id: studentId,
      post_type: 'text',
      content_text: 'rd-e2efl something odd',
      moderation_status: 'pending',
    },
  ]);
  const postId = requireId(posts[0], 'share_posts');
  const postFlags = await restInsert('flags', [
    {
      source: 'peer',
      entity_type: 'share_post',
      entity_id: postId,
      flagged_by: peerId,
      severity: 'medium',
    },
  ]);
  postFlagId = requireId(postFlags[0], 'flags');

  superToken = await login('admin', SUPER_EMAIL);
  mentorToken = await login('admin', MENTOR_EMAIL);
  studentToken = await login('student', STUDENT_CODE);
});

afterAll(cleanup);

type CenterFlag = {
  id: string;
  source: string;
  entityType: string;
  severity: string;
  status: string;
  studentName: string | null;
  detail: string | null;
  flaggedBy: string | null;
  adminNotes: string | null;
};

async function flagsFor(scope: 'open' | 'all'): Promise<CenterFlag[]> {
  const res = await callFunction(`admin-flags?scope=${scope}&page=1`, {
    method: 'GET',
    bearer: superToken,
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { flags: CenterFlag[] }).flags.filter(
    (f) => f.id === checkFlagId || f.id === postFlagId,
  );
}

describe('admin-flags Edge Function (E2E, no mocks)', () => {
  it('unifies AI and peer flags with safe context lines', async () => {
    const flags = await flagsFor('open');
    expect(flags).toHaveLength(2);

    const aiFlag = flags.find((f) => f.id === checkFlagId);
    expect(aiFlag?.source).toBe('ai');
    expect(aiFlag?.severity).toBe('high');
    expect(aiFlag?.studentName).toBe('Amber');
    expect(aiFlag?.detail).toContain('Crown Check 2030-06-03');
    expect(aiFlag?.detail).toContain('3 consecutive check-ins');
    expect(aiFlag?.flaggedBy).toBeNull();

    const peerFlag = flags.find((f) => f.id === postFlagId);
    expect(peerFlag?.source).toBe('peer');
    expect(peerFlag?.studentName).toBe('Amber');
    expect(peerFlag?.flaggedBy).toBe('Nia');
    // Context never carries content — only type, date and state.
    expect(peerFlag?.detail).not.toContain('something odd');
  });

  it('moves a flag through reviewed to resolved with the note kept', async () => {
    const review = await callFunction('admin-flags/update', {
      method: 'POST',
      bearer: superToken,
      body: { flagId: checkFlagId, status: 'reviewed' },
    });
    expect(review.status).toBe(200);

    const resolve = await callFunction('admin-flags/update', {
      method: 'POST',
      bearer: superToken,
      body: { flagId: checkFlagId, status: 'resolved', note: 'Called and prayed with her.' },
    });
    expect(resolve.status).toBe(200);

    // Gone from the open queue, present in history with the note.
    const open = await flagsFor('open');
    expect(open.some((f) => f.id === checkFlagId)).toBe(false);
    const all = await flagsFor('all');
    const resolved = all.find((f) => f.id === checkFlagId);
    expect(resolved?.status).toBe('resolved');
    expect(resolved?.adminNotes).toBe('Called and prayed with her.');

    const rows = await restSelect('flags', `id=eq.${checkFlagId}&select=reviewed_by,resolved_at`);
    expect(rows[0]?.reviewed_by).not.toBeNull();
    expect(rows[0]?.resolved_at).not.toBeNull();

    const audits = await restSelect(
      'audit_logs',
      `entity_id=eq.${checkFlagId}&entity_type=eq.flag&action=eq.update&select=id`,
    );
    expect(audits.length).toBeGreaterThanOrEqual(2);
  });

  it('denies mentors, students and anonymous callers', async () => {
    const asMentor = await callFunction('admin-flags?scope=open&page=1', {
      method: 'GET',
      bearer: mentorToken,
    });
    expect(asMentor.status).toBe(403);
    const asStudent = await callFunction('admin-flags?scope=open&page=1', {
      method: 'GET',
      bearer: studentToken,
    });
    expect(asStudent.status).toBe(403);
    const asNobody = await callFunction('admin-flags?scope=open&page=1', { method: 'GET' });
    expect(asNobody.status).toBe(401);
  });
});
