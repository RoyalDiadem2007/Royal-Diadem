/**
 * END-TO-END Queen Card server tests (SXU) — no mocks. Real HTTP → the real
 * student-profile Edge Function → real Postgres with real encryption: goal
 * titles, next steps, and "proud of" text are provably unreadable at rest,
 * ownership is enforced, the three-active-goals focus holds, and strengths
 * only come from the administrator-approved vocabulary.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callFunction, restDelete, restInsert, restSelect, API_URL } from './stack.ts';

// bcrypt(12) of '123456' — fixture PIN for the E2E accounts (local stack only).
const PIN_HASH_123456 = '$2b$12$6dESXMU6poUgaUoSTSce.ezSDJsy6vs4Pn4Ho5DFPOxoaxxXpRjMq';
const PIN = '123456';
const TURNSTILE_TOKEN = 'e2e-test-token-XXXX.DUMMY.TOKEN.XXXX';

const STUDENT_CODE = 'rd-e2eqp-a';
const OTHER_CODE = 'rd-e2eqp-b';
const SUPER_EMAIL = 'e2e-qp-super@example.com';
const STRENGTH_PREFIX = 'rd-e2eqp';

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

async function cleanup(): Promise<void> {
  const students = await restSelect('students', 'login_code=like.rd-e2eqp-%&select=id');
  if (students.length > 0) {
    const ids = students.map((s) => String(s.id)).join(',');
    await restDelete('student_strengths', `student_id=in.(${ids})`);
    await restDelete('student_goals', `student_id=in.(${ids})`);
    await restDelete('student_profiles', `student_id=in.(${ids})`);
    await restDelete('sessions', `subject_id=in.(${ids})`);
  }
  await restDelete('strength_options', `key=like.${STRENGTH_PREFIX}-%`);
  const admins = await restSelect('admin_users', `email=eq.${SUPER_EMAIL}&select=id`);
  if (admins.length > 0) {
    await restDelete('sessions', `subject_id=in.(${admins.map((a) => String(a.id)).join(',')})`);
  }
  await restDelete('auth_rate_limits', 'limit_key=like.profile%');
  await restDelete('auth_rate_limits', 'limit_key=like.login%');
  await restDelete('students', 'login_code=like.rd-e2eqp-%');
  await restDelete('admin_users', `email=eq.${SUPER_EMAIL}`);
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
    { name: 'QP Super', role: 'super_admin', pin_hash: PIN_HASH_123456, email: SUPER_EMAIL },
  ]);
  const superId = requireId(admins[0], 'admin_users');

  // The administrator-approved strengths vocabulary.
  await restInsert('strength_options', [
    { key: `${STRENGTH_PREFIX}-brave`, label: 'Brave', active: true, created_by: superId },
    { key: `${STRENGTH_PREFIX}-creative`, label: 'Creative', active: true, created_by: superId },
    { key: `${STRENGTH_PREFIX}-retired`, label: 'Retired', active: false, created_by: superId },
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

afterAll(cleanup);

type AvatarConfig = {
  skin: string;
  faceShape: string;
  eyes: string;
  nose: string;
  mouth: string;
  hair: string;
  hairColor: string;
  crown: string;
};

type ProfilePayload = {
  profile: { avatarKey: string | null; avatarConfig: AvatarConfig | null; proudOf: string | null };
  goals: {
    id: string;
    title: string;
    nextStep: string | null;
    status: string;
    targetDate: string | null;
    completedAt: string | null;
  }[];
  strengths: string[];
  strengthOptions: { key: string; label: string }[];
};

async function myProfile(token: string): Promise<ProfilePayload> {
  const res = await callFunction('student-profile', { method: 'GET', bearer: token });
  expect(res.status).toBe(200);
  return (await res.json()) as ProfilePayload;
}

describe('student-profile Edge Function (E2E, real encryption)', () => {
  let goalId = '';

  it('starts warm and empty: no profile row yet, options offered', async () => {
    const payload = await myProfile(studentToken);
    expect(payload.profile).toEqual({ avatarKey: null, avatarConfig: null, proudOf: null });
    expect(payload.goals).toEqual([]);
    expect(payload.strengths).toEqual([]);
    // Only ACTIVE vocabulary is offered.
    const keys = payload.strengthOptions.map((o) => o.key);
    expect(keys).toContain(`${STRENGTH_PREFIX}-brave`);
    expect(keys).not.toContain(`${STRENGTH_PREFIX}-retired`);
  });

  it('saves her profile with proud-of text encrypted at rest', async () => {
    const save = await callFunction('student-profile/update', {
      method: 'POST',
      bearer: studentToken,
      body: { avatarKey: 'crown-rose', proudOf: 'I stood up for my little brother.' },
    });
    expect(save.status).toBe(200);

    const rows = await restSelect(
      'student_profiles',
      `student_id=eq.${studentId}&select=avatar_key,proud_of_ciphertext`,
    );
    expect(rows[0]?.avatar_key).toBe('crown-rose');
    // The row never carries her words in the clear.
    expect(String(rows[0]?.proud_of_ciphertext)).not.toContain('little brother');

    const payload = await myProfile(studentToken);
    expect(payload.profile.proudOf).toBe('I stood up for my little brother.');
  });

  it('stores a composed avatar and rejects an off-vocabulary facet', async () => {
    const built: AvatarConfig = {
      skin: 'espresso',
      faceShape: 'heart',
      eyes: 'almond',
      nose: 'wide',
      mouth: 'full',
      hair: 'braids',
      hairColor: 'auburn',
      crown: 'tiara',
    };
    const save = await callFunction('student-profile/update', {
      method: 'POST',
      bearer: studentToken,
      body: { avatarKey: null, avatarConfig: built, proudOf: null },
    });
    expect(save.status).toBe(200);

    const payload = await myProfile(studentToken);
    expect(payload.profile.avatarConfig).toEqual(built);
    // The builder supersedes the legacy single mark.
    expect(payload.profile.avatarKey).toBeNull();

    // The server is the boundary: an invented facet value is refused.
    const bad = await callFunction('student-profile/update', {
      method: 'POST',
      bearer: studentToken,
      body: { avatarKey: null, avatarConfig: { ...built, hair: 'mohawk' }, proudOf: null },
    });
    expect(bad.status).toBe(400);
  });

  it('creates a goal, encrypted at rest, and reads it back decrypted', async () => {
    const create = await callFunction('student-profile/goals/create', {
      method: 'POST',
      bearer: studentToken,
      body: {
        title: 'Speak kindly to myself',
        nextStep: 'Name one thing I handled well today',
        targetDate: '2030-09-01',
      },
    });
    expect(create.status).toBe(201);
    goalId = ((await create.json()) as { goalId: string }).goalId;

    const rows = await restSelect(
      'student_goals',
      `id=eq.${goalId}&select=title_ciphertext,next_step_ciphertext,status`,
    );
    expect(String(rows[0]?.title_ciphertext)).not.toContain('kindly');
    expect(String(rows[0]?.next_step_ciphertext)).not.toContain('handled well');
    expect(rows[0]?.status).toBe('not_started');

    const payload = await myProfile(studentToken);
    const goal = payload.goals.find((g) => g.id === goalId);
    expect(goal?.title).toBe('Speak kindly to myself');
    expect(goal?.nextStep).toBe('Name one thing I handled well today');
  });

  it('keeps the gentle focus: at most three goals in motion', async () => {
    for (const title of ['Second goal', 'Third goal']) {
      const res = await callFunction('student-profile/goals/create', {
        method: 'POST',
        bearer: studentToken,
        body: { title, nextStep: null, targetDate: null },
      });
      expect(res.status).toBe(201);
    }
    const fourth = await callFunction('student-profile/goals/create', {
      method: 'POST',
      bearer: studentToken,
      body: { title: 'One too many', nextStep: null, targetDate: null },
    });
    expect(fourth.status).toBe(409);
    expect(((await fourth.json()) as { error: string }).error).toBe('goal_limit');

    // Completing one frees a place — growth, not a cap on her.
    const complete = await callFunction('student-profile/goals/update', {
      method: 'POST',
      bearer: studentToken,
      body: {
        goalId,
        title: 'Speak kindly to myself',
        nextStep: null,
        status: 'completed',
        targetDate: null,
      },
    });
    expect(complete.status).toBe(200);
    const payload = await myProfile(studentToken);
    expect(payload.goals.find((g) => g.id === goalId)?.completedAt).not.toBeNull();

    const fifth = await callFunction('student-profile/goals/create', {
      method: 'POST',
      bearer: studentToken,
      body: { title: 'Room again', nextStep: null, targetDate: null },
    });
    expect(fifth.status).toBe(201);
  });

  it("never lets one student touch another's goal", async () => {
    const foreign = await callFunction('student-profile/goals/update', {
      method: 'POST',
      bearer: otherToken,
      body: {
        goalId,
        title: 'hijacked',
        nextStep: null,
        status: 'growing',
        targetDate: null,
      },
    });
    expect(foreign.status).toBe(404);
    const payload = await myProfile(studentToken);
    expect(payload.goals.find((g) => g.id === goalId)?.title).toBe('Speak kindly to myself');
  });

  it('accepts only administrator-approved, active strengths', async () => {
    const good = await callFunction('student-profile/strengths', {
      method: 'POST',
      bearer: studentToken,
      body: { keys: [`${STRENGTH_PREFIX}-brave`, `${STRENGTH_PREFIX}-creative`] },
    });
    expect(good.status).toBe(200);
    expect((await myProfile(studentToken)).strengths.sort()).toEqual([
      `${STRENGTH_PREFIX}-brave`,
      `${STRENGTH_PREFIX}-creative`,
    ]);

    const retired = await callFunction('student-profile/strengths', {
      method: 'POST',
      bearer: studentToken,
      body: { keys: [`${STRENGTH_PREFIX}-retired`] },
    });
    expect(retired.status).toBe(400);

    // Replacing the set replaces it — the old picks don't linger.
    const replace = await callFunction('student-profile/strengths', {
      method: 'POST',
      bearer: studentToken,
      body: { keys: [`${STRENGTH_PREFIX}-creative`] },
    });
    expect(replace.status).toBe(200);
    expect((await myProfile(studentToken)).strengths).toEqual([`${STRENGTH_PREFIX}-creative`]);
  });

  it('denies admins and anonymous callers; audits her writes', async () => {
    const asAdmin = await callFunction('student-profile', { method: 'GET', bearer: superToken });
    expect(asAdmin.status).toBe(403);
    const asNobody = await callFunction('student-profile', { method: 'GET' });
    expect(asNobody.status).toBe(401);

    const audits = await restSelect(
      'audit_logs',
      `actor_id=eq.${studentId}&entity_type=eq.student_goal&select=action`,
    );
    expect(audits.length).toBeGreaterThanOrEqual(2);
  });
});
