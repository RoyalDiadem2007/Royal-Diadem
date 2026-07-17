/**
 * END-TO-END magic-link onboarding tests (Phase 4c, OD-19) — no mocks beyond
 * the env-gated log email transport (the one true external boundary). Real
 * HTTP → real Edge Functions → real Postgres: real enrollment with emails,
 * real link issuance/revocation, real single-use hashed-token claims, real
 * fresh-PIN issuance proven by a real login, real audit rows.
 */
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callFunction, restDelete, restInsert, restSelect, restUpdate, API_URL } from './stack.ts';

const PIN_HASH_123456 = '$2b$12$6dESXMU6poUgaUoSTSce.ezSDJsy6vs4Pn4Ho5DFPOxoaxxXpRjMq';
const PIN = '123456';
const TURNSTILE_TOKEN = 'e2e-test-token-XXXX.DUMMY.TOKEN.XXXX';

// Fixture marker: students enrolled through the API get this school name so
// cleanup can find them (their crown codes are generated, not predictable).
const MARKER_SCHOOL = 'rd-e2eml-school';
const SUPER_EMAIL = 'e2e-ml-super@example.com';

let superId = '';
let superToken = '';

function requireId(row: Record<string, unknown> | undefined, what: string): string {
  const id = row?.id;
  if (typeof id !== 'string' || id === '') {
    throw new Error(`seeding ${what} failed`);
  }
  return id;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function rawToken(): string {
  return randomBytes(32).toString('base64url');
}

/** ISO date `years` back from today (UTC) — age fixtures. */
function dobYearsAgo(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() - 30); // clearly past the birthday
  return d.toISOString().slice(0, 10);
}

async function login(subjectType: 'student' | 'admin', identifier: string, pin = PIN) {
  return callFunction('auth-login', {
    method: 'POST',
    body: { subjectType, identifier, pin, turnstileToken: TURNSTILE_TOKEN },
  });
}

async function adminToken(): Promise<string> {
  const res = await login('admin', SUPER_EMAIL);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { token?: string };
  if (typeof body.token !== 'string') {
    throw new Error('admin login fixture failed');
  }
  return body.token;
}

async function cleanup(): Promise<void> {
  const students = await restSelect('students', `school_name=eq.${MARKER_SCHOOL}&select=id`);
  const ids = students.map((s) => String(s.id));
  if (ids.length > 0) {
    const filter = `student_id=in.(${ids.join(',')})`;
    await restDelete('magic_links', filter);
    await restDelete('guardians', filter);
    await restDelete('sessions', `subject_id=in.(${ids.join(',')})`);
    await restDelete('students', `id=in.(${ids.join(',')})`);
  }
  const admins = await restSelect('admin_users', `email=eq.${SUPER_EMAIL}&select=id`);
  if (admins.length > 0) {
    await restDelete('sessions', `subject_id=in.(${admins.map((a) => String(a.id)).join(',')})`);
  }
  await restDelete('auth_rate_limits', 'limit_key=like.login%');
  await restDelete('auth_rate_limits', 'limit_key=like.claim%');
  await restDelete('admin_users', `email=eq.${SUPER_EMAIL}`);
}

/** Enrolls through the real API; returns the created student + one-time PIN. */
async function enroll(input: Record<string, unknown>) {
  const res = await callFunction('admin-students/create', {
    method: 'POST',
    bearer: superToken,
    body: { schoolName: MARKER_SCHOOL, ...input },
  });
  return res;
}

/** Seeds a claimable link directly (raw token known to the test). */
async function seedLink(
  studentId: string,
  recipient: 'student' | 'guardian',
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const token = rawToken();
  let guardianId: string | null = null;
  if (recipient === 'guardian') {
    const guardians = await restSelect('guardians', `student_id=eq.${studentId}&select=id`);
    guardianId = requireId(guardians[0], 'guardians');
  }
  await restInsert('magic_links', [
    {
      student_id: studentId,
      recipient,
      guardian_id: guardianId,
      token_hash: sha256Hex(token),
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      created_by: superId,
      ...overrides,
    },
  ]);
  return token;
}

async function claim(token: string) {
  return callFunction('magic-link-claim', {
    method: 'POST',
    body: { token, turnstileToken: TURNSTILE_TOKEN },
  });
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
    { name: 'ML Super', role: 'super_admin', pin_hash: PIN_HASH_123456, email: SUPER_EMAIL },
  ]);
  superId = requireId(admins[0], 'admin_users');
  superToken = await adminToken();
});

afterAll(cleanup);

describe('enrollment with emails (E2E, no mocks)', () => {
  it('stores a 13+ student email and creates the guardian record together', async () => {
    const res = await enroll({
      firstName: 'Maya',
      lastName: 'Linked',
      displayName: 'Maya',
      dateOfBirth: dobYearsAgo(16),
      studentEmail: 'maya-ml@example.com',
      guardianName: 'Rae Linked',
      guardianEmail: 'rae-ml@example.com',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { student: { id: string; email: string | null } };
    expect(body.student.email).toBe('maya-ml@example.com');

    const guardians = await restSelect(
      'guardians',
      `student_id=eq.${body.student.id}&select=guardian_name,email,relationship`,
    );
    expect(guardians).toHaveLength(1);
    expect(guardians[0]?.email).toBe('rae-ml@example.com');
    expect(guardians[0]?.relationship).toBe('parent');
  });

  it("rejects an under-13 enrollment carrying the student's own email (OD-19)", async () => {
    const res = await enroll({
      firstName: 'Ivy',
      lastName: 'Young',
      displayName: 'Ivy',
      dateOfBirth: dobYearsAgo(11),
      studentEmail: 'ivy-ml@example.com',
    });
    expect(res.status).toBe(400);
  });
});

describe('send-link age matrix (E2E, log email transport)', () => {
  it('sends to the student inbox at 13+ and audits it; resend revokes the old link', async () => {
    const created = await enroll({
      firstName: 'Sena',
      lastName: 'Older',
      displayName: 'Sena',
      dateOfBirth: dobYearsAgo(14),
      studentEmail: 'sena-ml@example.com',
    });
    expect(created.status).toBe(201);
    const { student } = (await created.json()) as { student: { id: string } };

    const first = await callFunction('admin-students/send-link', {
      method: 'POST',
      bearer: superToken,
      body: { studentId: student.id },
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { recipient: string };
    expect(firstBody.recipient).toBe('student');

    const second = await callFunction('admin-students/send-link', {
      method: 'POST',
      bearer: superToken,
      body: { studentId: student.id },
    });
    expect(second.status).toBe(200);

    const links = await restSelect(
      'magic_links',
      `student_id=eq.${student.id}&select=revoked_at&order=created_at.asc`,
    );
    expect(links).toHaveLength(2);
    expect(links[0]?.revoked_at).not.toBeNull(); // exactly one live link at a time
    expect(links[1]?.revoked_at).toBeNull();

    const audits = await restSelect(
      'audit_logs',
      `entity_type=eq.magic_link&entity_id=eq.${student.id}&outcome=eq.allowed&select=metadata`,
    );
    expect(audits.length).toBeGreaterThanOrEqual(2);
  });

  it('refuses an under-13 send until consent is verified, then goes to the guardian', async () => {
    const created = await enroll({
      firstName: 'Pia',
      lastName: 'Younger',
      displayName: 'Pia',
      dateOfBirth: dobYearsAgo(12),
      guardianName: 'Mel Younger',
      guardianEmail: 'mel-ml@example.com',
    });
    expect(created.status).toBe(201);
    const { student } = (await created.json()) as { student: { id: string } };

    const blocked = await callFunction('admin-students/send-link', {
      method: 'POST',
      bearer: superToken,
      body: { studentId: student.id },
    });
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as { error?: string }).error).toBe('consent_pending');

    await restUpdate('students', `id=eq.${student.id}`, { coppa_consent_status: 'verified' });

    const sent = await callFunction('admin-students/send-link', {
      method: 'POST',
      bearer: superToken,
      body: { studentId: student.id },
    });
    expect(sent.status).toBe(200);
    expect(((await sent.json()) as { recipient?: string }).recipient).toBe('guardian');
  });

  it('names the missing precondition when no email is on file', async () => {
    const created = await enroll({
      firstName: 'Noa',
      lastName: 'Cardonly',
      displayName: 'Noa',
      dateOfBirth: dobYearsAgo(15),
    });
    const { student } = (await created.json()) as { student: { id: string } };

    const res = await callFunction('admin-students/send-link', {
      method: 'POST',
      bearer: superToken,
      body: { studentId: student.id },
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error?: string }).error).toBe('no_student_email');
  });

  it('denies a student session on send-link with 403', async () => {
    const created = await enroll({
      firstName: 'Tess',
      lastName: 'Denied',
      displayName: 'Tess',
      dateOfBirth: dobYearsAgo(16),
    });
    const { student, pin } = (await created.json()) as {
      student: { id: string; loginCode: string };
      pin: string;
    };
    const studentLogin = await login('student', student.loginCode, pin);
    expect(studentLogin.status).toBe(200);
    const { token } = (await studentLogin.json()) as { token: string };

    const res = await callFunction('admin-students/send-link', {
      method: 'POST',
      bearer: token,
      body: { studentId: student.id },
    });
    expect(res.status).toBe(403);
  });
});

describe('magic-link-claim (E2E, no mocks)', () => {
  it('claims once: fresh PIN works for a real login, old PIN and sessions die', async () => {
    const created = await enroll({
      firstName: 'Vera',
      lastName: 'Claimer',
      displayName: 'Vera',
      dateOfBirth: dobYearsAgo(17),
      studentEmail: 'vera-ml@example.com',
    });
    const { student, pin: oldPin } = (await created.json()) as {
      student: { id: string; loginCode: string };
      pin: string;
    };

    // A pre-claim session that must die when the claim rotates credentials.
    const preLogin = await login('student', student.loginCode, oldPin);
    expect(preLogin.status).toBe(200);
    const { token: preSession } = (await preLogin.json()) as { token: string };

    const token = await seedLink(student.id, 'student');
    const res = await claim(token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      token: string;
      subject: { id: string; type: string };
      credentials: { crownCode: string; pin: string };
    };
    expect(body.subject.id).toBe(student.id);
    expect(body.subject.type).toBe('student');
    expect(body.credentials.crownCode).toBe(student.loginCode);
    expect(body.credentials.pin).toMatch(/^\d{6}$/);
    expect(body.credentials.pin).not.toBe(oldPin);

    // The minted session is live (student endpoint accepts it).
    const me = await callFunction('crown-check', { method: 'GET', bearer: body.token });
    expect(me.status).toBe(200);

    // The pre-claim session was revoked.
    const dead = await callFunction('crown-check', { method: 'GET', bearer: preSession });
    expect(dead.status).toBe(401);

    // Old PIN dead, fresh PIN real — the whole point of claim-time issuance.
    expect((await login('student', student.loginCode, oldPin)).status).toBe(401);
    expect((await login('student', student.loginCode, body.credentials.pin)).status).toBe(200);

    // Single-use: a second claim of the same link fails generically.
    const again = await claim(token);
    expect(again.status).toBe(401);
    expect(((await again.json()) as { error?: string }).error).toBe('invalid_link');

    const audits = await restSelect(
      'audit_logs',
      `actor_id=eq.${student.id}&entity_type=eq.magic_link&outcome=eq.allowed&action=eq.login&limit=1`,
    );
    expect(audits).toHaveLength(1);
  });

  it('claims a guardian-recipient link for an under-13 set up together (consent verified)', async () => {
    const created = await enroll({
      firstName: 'Wren',
      lastName: 'Guarded',
      displayName: 'Wren',
      dateOfBirth: dobYearsAgo(12),
      guardianName: 'Sol Guarded',
      guardianEmail: 'sol-ml@example.com',
    });
    const { student } = (await created.json()) as { student: { id: string } };
    await restUpdate('students', `id=eq.${student.id}`, { coppa_consent_status: 'verified' });

    const token = await seedLink(student.id, 'guardian');
    const res = await claim(token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { subject: { id: string; type: string } };
    // The session is always the STUDENT's — guardians have no session type yet.
    expect(body.subject.type).toBe('student');
    expect(body.subject.id).toBe(student.id);
  });

  it('blocks the claim while under-13 consent is pending', async () => {
    const created = await enroll({
      firstName: 'Uma',
      lastName: 'Pending',
      displayName: 'Uma',
      dateOfBirth: dobYearsAgo(11),
      guardianName: 'Kai Pending',
      guardianEmail: 'kai-ml@example.com',
    });
    const { student } = (await created.json()) as { student: { id: string } };

    const token = await seedLink(student.id, 'guardian');
    const res = await claim(token);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error?: string }).error).toBe('consent_pending');
  });

  it('rejects expired and revoked links with the same generic code', async () => {
    const created = await enroll({
      firstName: 'Xia',
      lastName: 'Stale',
      displayName: 'Xia',
      dateOfBirth: dobYearsAgo(15),
      studentEmail: 'xia-ml@example.com',
    });
    const { student } = (await created.json()) as { student: { id: string } };

    const expired = await seedLink(student.id, 'student', {
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    const expiredRes = await claim(expired);
    expect(expiredRes.status).toBe(401);
    expect(((await expiredRes.json()) as { error?: string }).error).toBe('invalid_link');

    const revoked = await seedLink(student.id, 'student', {
      revoked_at: new Date().toISOString(),
    });
    const revokedRes = await claim(revoked);
    expect(revokedRes.status).toBe(401);
    expect(((await revokedRes.json()) as { error?: string }).error).toBe('invalid_link');
  });

  it('rejects an unknown token with 401 and a malformed body with 400', async () => {
    expect((await claim(rawToken())).status).toBe(401);
    const malformed = await callFunction('magic-link-claim', {
      method: 'POST',
      body: { token: 'x', turnstileToken: TURNSTILE_TOKEN },
    });
    expect(malformed.status).toBe(400);
  });
});
