/**
 * END-TO-END Calendar + Announcements tests (Phase 9) — no mocks. Real HTTP
 * → the real admin-calendar / admin-announcements / announcement-reads Edge
 * Functions → real Postgres, plus the anon Data API path the student cards
 * use (RLS is the boundary there: only visibility='all' events, and no anon
 * writes anywhere).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anonKey, callFunction, restDelete, restInsert, restSelect, API_URL } from './stack.ts';

// bcrypt(12) of '123456' — fixture PIN for the E2E accounts (local stack only).
const PIN_HASH_123456 = '$2b$12$6dESXMU6poUgaUoSTSce.ezSDJsy6vs4Pn4Ho5DFPOxoaxxXpRjMq';
const PIN = '123456';
// Any token passes with the Turnstile test secret; length must satisfy the schema.
const TURNSTILE_TOKEN = 'e2e-test-token-XXXX.DUMMY.TOKEN.XXXX';

// Distinct fixture namespace — other suites clean different prefixes.
const STUDENT_CODE = 'rd-e2eca-a';
const STAFF_CODE = 'rd-e2eca-staff';
const SUPER_EMAIL = 'e2e-ca-super@example.com';
const MENTOR_EMAIL = 'e2e-ca-mentor@example.com';
const MARK = 'rd-e2eca';

// Fixture dates far in the future so "from today" listings always include them.
const EVENT_DATE = '2032-04-06';
const EVENT_UNTIL = '2032-04-27';

let superId = '';
let studentId = '';
let staffStudentId = '';
let superToken = '';
let mentorToken = '';
let studentToken = '';

function requireId(row: Record<string, unknown> | undefined, what: string): string {
  const id = row?.id;
  if (typeof id !== 'string' || id === '') {
    throw new Error(`seeding ${what} failed`);
  }
  return id;
}

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
  await restDelete('calendar_events', `title=like.${MARK}%`);
  const announcements = await restSelect('announcements', `title=like.${MARK}%&select=id`);
  if (announcements.length > 0) {
    const ids = announcements.map((a) => String(a.id));
    await restDelete('announcement_reads', `announcement_id=in.(${ids.join(',')})`);
    await restDelete('announcements', `id=in.(${ids.join(',')})`);
  }
  const students = await restSelect('students', 'login_code=like.rd-e2eca-%&select=id');
  if (students.length > 0) {
    const ids = students.map((s) => String(s.id));
    await restDelete('announcement_reads', `student_id=in.(${ids.join(',')})`);
    await restDelete('sessions', `subject_id=in.(${ids.join(',')})`);
  }
  const admins = await restSelect(
    'admin_users',
    `email=in.(${SUPER_EMAIL},${MENTOR_EMAIL})&select=id`,
  );
  if (admins.length > 0) {
    await restDelete('sessions', `subject_id=in.(${admins.map((a) => String(a.id)).join(',')})`);
  }
  await restDelete('auth_rate_limits', 'limit_key=like.login%');
  await restDelete('students', 'login_code=like.rd-e2eca-%');
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

  const admins = await restInsert('admin_users', [
    { name: 'CA Super', role: 'super_admin', pin_hash: PIN_HASH_123456, email: SUPER_EMAIL },
    { name: 'CA Mentor', role: 'mentor', pin_hash: PIN_HASH_123456, email: MENTOR_EMAIL },
  ]);
  superId = requireId(admins[0], 'admin_users');

  const students = await restInsert('students', [
    {
      first_name: 'Grace',
      last_name: 'Calendar',
      display_name: 'Grace',
      date_of_birth: '2011-03-01',
      pin_hash: PIN_HASH_123456,
      login_code: STUDENT_CODE,
      status: 'active',
      coppa_required: false,
      coppa_consent_status: 'verified',
      staff_owner_admin_id: null,
    },
    {
      first_name: 'Staff',
      last_name: 'Identity',
      display_name: 'Staff',
      date_of_birth: '1990-01-01',
      pin_hash: PIN_HASH_123456,
      login_code: STAFF_CODE,
      status: 'active',
      coppa_required: false,
      coppa_consent_status: 'verified',
      staff_owner_admin_id: superId,
    },
  ]);
  studentId = requireId(students[0], 'students');
  staffStudentId = requireId(students[1], 'students');

  superToken = await login('admin', SUPER_EMAIL);
  mentorToken = await login('admin', MENTOR_EMAIL);
  studentToken = await login('student', STUDENT_CODE);
});

afterAll(cleanup);

describe('admin-calendar Edge Function (E2E, no mocks)', () => {
  it('creates, edits and deletes an event, audit-logged, weekly rule intact', async () => {
    const create = await callFunction('admin-calendar/create', {
      method: 'POST',
      bearer: superToken,
      body: {
        title: `${MARK} Bible study`,
        description: 'Bring your journal',
        eventDate: EVENT_DATE,
        eventTime: '18:00',
        endTime: '19:30',
        repeatsWeekly: true,
        repeatUntil: EVENT_UNTIL,
      },
    });
    expect(create.status).toBe(201);
    const created = ((await create.json()) as { event: { id: string; recurrenceRule: string } })
      .event;
    expect(created.recurrenceRule).toBe('FREQ=WEEKLY;UNTIL=20320427');

    const rows = await restSelect(
      'calendar_events',
      `id=eq.${created.id}&select=is_recurring,visibility,created_by`,
    );
    expect(rows[0]?.is_recurring).toBe(true);
    expect(rows[0]?.visibility).toBe('all');
    expect(rows[0]?.created_by).toBe(superId);

    const audits = await restSelect(
      'audit_logs',
      `entity_id=eq.${created.id}&entity_type=eq.calendar_event&action=eq.create&select=outcome`,
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.outcome).toBe('allowed');

    const update = await callFunction('admin-calendar/update', {
      method: 'POST',
      bearer: superToken,
      body: {
        eventId: created.id,
        title: `${MARK} Bible study (moved)`,
        description: null,
        eventDate: EVENT_DATE,
        eventTime: '19:00',
        endTime: null,
        repeatsWeekly: false,
        repeatUntil: null,
      },
    });
    expect(update.status).toBe(200);
    const updated = (
      (await update.json()) as {
        event: { title: string; eventTime: string | null; recurrenceRule: string | null };
      }
    ).event;
    expect(updated.title).toBe(`${MARK} Bible study (moved)`);
    expect(updated.eventTime).toBe('19:00');
    expect(updated.recurrenceRule).toBeNull();

    const list = await callFunction(`admin-calendar?page=1`, {
      method: 'GET',
      bearer: superToken,
    });
    expect(list.status).toBe(200);
    const events = ((await list.json()) as { events: { id: string }[] }).events;
    expect(events.some((e) => e.id === created.id)).toBe(true);

    const del = await callFunction('admin-calendar/delete', {
      method: 'POST',
      bearer: superToken,
      body: { eventId: created.id },
    });
    expect(del.status).toBe(200);
    expect(await restSelect('calendar_events', `id=eq.${created.id}&select=id`)).toHaveLength(0);
  });

  it('rejects invalid shapes: end time without a start, until without weekly', async () => {
    const noStart = await callFunction('admin-calendar/create', {
      method: 'POST',
      bearer: superToken,
      body: {
        title: `${MARK} broken`,
        description: null,
        eventDate: EVENT_DATE,
        eventTime: null,
        endTime: '19:00',
        repeatsWeekly: false,
        repeatUntil: null,
      },
    });
    expect(noStart.status).toBe(400);

    const strayUntil = await callFunction('admin-calendar/create', {
      method: 'POST',
      bearer: superToken,
      body: {
        title: `${MARK} broken`,
        description: null,
        eventDate: EVENT_DATE,
        eventTime: null,
        endTime: null,
        repeatsWeekly: false,
        repeatUntil: EVENT_UNTIL,
      },
    });
    expect(strayUntil.status).toBe(400);
  });

  it('denies mentors, students and anonymous callers', async () => {
    const body = {
      title: `${MARK} nope`,
      description: null,
      eventDate: EVENT_DATE,
      eventTime: null,
      endTime: null,
      repeatsWeekly: false,
      repeatUntil: null,
    };
    const asMentor = await callFunction('admin-calendar/create', {
      method: 'POST',
      bearer: mentorToken,
      body,
    });
    expect(asMentor.status).toBe(403);
    const asStudent = await callFunction('admin-calendar/create', {
      method: 'POST',
      bearer: studentToken,
      body,
    });
    expect(asStudent.status).toBe(403);
    const asNobody = await callFunction('admin-calendar/create', { method: 'POST', body });
    expect(asNobody.status).toBe(401);
  });
});

describe('calendar anon read path (RLS is the boundary)', () => {
  it('shows visibility=all events and hides everything else from anon', async () => {
    await restInsert('calendar_events', [
      {
        title: `${MARK} public night`,
        description: null,
        event_date: EVENT_DATE,
        event_time: null,
        end_time: null,
        is_recurring: false,
        recurrence_rule: null,
        visibility: 'all',
        created_by: superId,
      },
      {
        title: `${MARK} hidden group session`,
        description: null,
        event_date: EVENT_DATE,
        event_time: null,
        end_time: null,
        is_recurring: false,
        recurrence_rule: null,
        visibility: 'specific_group',
        created_by: superId,
      },
    ]);

    const res = await anonRest(`calendar_events?title=like.${MARK}%25&select=title,visibility`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { title: string; visibility: string }[];
    expect(rows.some((r) => r.title === `${MARK} public night`)).toBe(true);
    expect(rows.every((r) => r.visibility === 'all')).toBe(true);
    expect(rows.some((r) => r.title === `${MARK} hidden group session`)).toBe(false);
  });

  it('denies anon writes to calendar_events', async () => {
    const insert = await anonRest('calendar_events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `${MARK} forged`,
        event_date: EVENT_DATE,
        visibility: 'all',
        created_by: superId,
      }),
    });
    expect([401, 403]).toContain(insert.status);
  });
});

describe('announcements + read receipts (E2E, no mocks)', () => {
  let announcementId = '';

  it('posts an urgent announcement and lists it with zeroed read count', async () => {
    const create = await callFunction('admin-announcements/create', {
      method: 'POST',
      bearer: superToken,
      body: { title: `${MARK} Retreat`, body: 'Sign up by Friday!', priority: 'urgent' },
    });
    expect(create.status).toBe(201);
    announcementId = ((await create.json()) as { announcement: { id: string } }).announcement.id;

    const list = await callFunction('admin-announcements?page=1', {
      method: 'GET',
      bearer: superToken,
    });
    expect(list.status).toBe(200);
    const page = (await list.json()) as {
      announcements: { id: string; priority: string; readCount: number }[];
      activeStudents: number;
    };
    const mine = page.announcements.find((a) => a.id === announcementId);
    expect(mine?.priority).toBe('urgent');
    expect(mine?.readCount).toBe(0);

    // The denominator counts active REAL students only — never staff
    // identities. Verified against the same live table state.
    const realActive = await restSelect(
      'students',
      'status=eq.active&staff_owner_admin_id=is.null&select=id',
    );
    expect(page.activeStudents).toBe(realActive.length);
  });

  it('lets anon read the feed but never write it', async () => {
    const read = await anonRest(`announcements?id=eq.${announcementId}&select=title,priority`);
    expect(read.status).toBe(200);
    expect((await read.json()) as unknown[]).toHaveLength(1);

    const insert = await anonRest('announcements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `${MARK} forged`, body: 'x', posted_by: superId }),
    });
    expect([401, 403]).toContain(insert.status);
  });

  it('records a student read once, idempotently, ignoring unknown ids', async () => {
    const ghostId = '00000000-0000-0000-0000-000000000000';
    const first = await callFunction('announcement-reads', {
      method: 'POST',
      bearer: studentToken,
      body: { announcementIds: [announcementId, ghostId] },
    });
    expect(first.status).toBe(200);
    expect(((await first.json()) as { marked: number }).marked).toBe(1);

    const again = await callFunction('announcement-reads', {
      method: 'POST',
      bearer: studentToken,
      body: { announcementIds: [announcementId] },
    });
    expect(again.status).toBe(200);

    const receipts = await restSelect(
      'announcement_reads',
      `announcement_id=eq.${announcementId}&select=student_id`,
    );
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.student_id).toBe(studentId);
  });

  it('excludes staff-identity receipts from admin read counts', async () => {
    await restInsert('announcement_reads', [
      { announcement_id: announcementId, student_id: staffStudentId },
    ]);

    const list = await callFunction('admin-announcements?page=1', {
      method: 'GET',
      bearer: superToken,
    });
    const page = (await list.json()) as {
      announcements: { id: string; readCount: number }[];
    };
    const mine = page.announcements.find((a) => a.id === announcementId);
    // Two receipt rows exist, but only the real student counts.
    expect(mine?.readCount).toBe(1);
  });

  it('denies admins on the student receipts endpoint and anon everywhere', async () => {
    const asAdmin = await callFunction('announcement-reads', {
      method: 'POST',
      bearer: superToken,
      body: { announcementIds: [announcementId] },
    });
    expect(asAdmin.status).toBe(403);
    const asNobody = await callFunction('announcement-reads', {
      method: 'POST',
      body: { announcementIds: [announcementId] },
    });
    expect(asNobody.status).toBe(401);
  });

  it('deletes the announcement together with its receipts', async () => {
    const del = await callFunction('admin-announcements/delete', {
      method: 'POST',
      bearer: superToken,
      body: { announcementId },
    });
    expect(del.status).toBe(200);
    expect(await restSelect('announcements', `id=eq.${announcementId}&select=id`)).toHaveLength(0);
    expect(
      await restSelect('announcement_reads', `announcement_id=eq.${announcementId}&select=id`),
    ).toHaveLength(0);
  });
});
