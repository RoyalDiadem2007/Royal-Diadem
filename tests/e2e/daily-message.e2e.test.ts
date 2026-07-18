/**
 * END-TO-END Daily Crown Message tests (Phase 8) — the anon read path the
 * student client uses. No Edge Function sits in front of this read, so the
 * RLS policy ("anon reads only posted daily messages") IS the security
 * boundary; these tests prove it against the real local stack.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anonKey, restDelete, restInsert, API_URL } from './stack.ts';

// A fixed far-future week so reruns and other suites never collide.
const WEEK = '2031-03-03';
const DAY = '2031-03-04';
const OTHER_DAY = '2031-03-05';
const MARK = 'rd-e2edm';

const POSTED_EARLY = `${MARK} You are seen and you are loved.`;
const POSTED_LATE = `${MARK} Walk tall today, queen.`;
const DRAFT_TEXT = `${MARK} Draft that no student may ever see.`;

function anonHeaders(): Record<string, string> {
  return { apikey: anonKey(), Authorization: `Bearer ${anonKey()}` };
}

/** The exact query shape the client's fetchDailyMessage sends. */
function clientQuery(day: string): string {
  return (
    'select=message_text,scheduled_date' +
    `&status=eq.posted&scheduled_date=eq.${day}` +
    '&order=posted_at.desc&limit=1'
  );
}

async function anonSelect(query: string): Promise<Response> {
  return fetch(`${API_URL}/rest/v1/encouragement_messages?${query}`, {
    headers: anonHeaders(),
  });
}

async function cleanup(): Promise<void> {
  await restDelete('encouragement_messages', `week_of=eq.${WEEK}`);
}

beforeAll(async () => {
  const reachable = await fetch(`${API_URL}/rest/v1/`, { method: 'HEAD' })
    .then((ping) => ping.status < 500)
    .catch(() => false);
  if (!reachable) {
    throw new Error(`Supabase stack unreachable at ${API_URL} — run: npx supabase start`);
  }
  await cleanup();
  await restInsert('encouragement_messages', [
    {
      message_text: POSTED_EARLY,
      source: 'admin_written',
      scheduled_date: DAY,
      week_of: WEEK,
      status: 'posted',
      posted_at: '2031-03-01T09:00:00Z',
    },
    {
      message_text: POSTED_LATE,
      source: 'ai_generated',
      scheduled_date: DAY,
      week_of: WEEK,
      status: 'posted',
      posted_at: '2031-03-02T09:00:00Z',
    },
    {
      message_text: DRAFT_TEXT,
      source: 'ai_generated',
      scheduled_date: DAY,
      week_of: WEEK,
      status: 'draft',
      // PostgREST bulk inserts require identical keys on every row.
      posted_at: null,
    },
    {
      message_text: `${MARK} Tomorrow's word, posted but not for today.`,
      source: 'admin_written',
      scheduled_date: OTHER_DAY,
      week_of: WEEK,
      status: 'posted',
      posted_at: '2031-03-02T09:00:00Z',
    },
  ]);
});

afterAll(cleanup);

describe('daily message anon read (RLS is the boundary)', () => {
  it("serves exactly one row — the day's most recently posted message", async () => {
    const res = await anonSelect(clientQuery(DAY));
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { message_text: string; scheduled_date: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.message_text).toBe(POSTED_LATE);
    expect(rows[0]?.scheduled_date).toBe(DAY);
  });

  it('returns an empty set for a day with nothing posted', async () => {
    const res = await anonSelect(clientQuery('2031-03-06'));
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown[]).toHaveLength(0);
  });

  it('never exposes unposted rows, even to an unfiltered anon select', async () => {
    const res = await anonSelect(`week_of=eq.${WEEK}&select=message_text,status`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { message_text: string; status: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.status === 'posted')).toBe(true);
    expect(rows.some((row) => row.message_text === DRAFT_TEXT)).toBe(false);
  });

  it('denies anon writes: no insert, no update, no delete', async () => {
    const insert = await fetch(`${API_URL}/rest/v1/encouragement_messages`, {
      method: 'POST',
      headers: { ...anonHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message_text: `${MARK} forged`,
        source: 'admin_written',
        scheduled_date: DAY,
        week_of: WEEK,
        status: 'posted',
      }),
    });
    expect([401, 403]).toContain(insert.status);

    const update = await fetch(
      `${API_URL}/rest/v1/encouragement_messages?week_of=eq.${WEEK}&status=eq.posted`,
      {
        method: 'PATCH',
        headers: { ...anonHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_text: `${MARK} defaced` }),
      },
    );
    expect([401, 403]).toContain(update.status);

    const del = await fetch(`${API_URL}/rest/v1/encouragement_messages?week_of=eq.${WEEK}`, {
      method: 'DELETE',
      headers: anonHeaders(),
    });
    expect([401, 403]).toContain(del.status);

    // The posted message is untouched after all three attempts.
    const after = await anonSelect(clientQuery(DAY));
    const rows = (await after.json()) as { message_text: string }[];
    expect(rows[0]?.message_text).toBe(POSTED_LATE);
  });
});
