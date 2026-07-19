/**
 * Encouragement section tests through the real App. Only fetch is mocked.
 * The load-bearing assertions: the human-gate copy, the reject/replace
 * reason capture (the corrective loop's input), and posting only approved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { resetAuthForTests } from '@/lib/authStore';
import { mondayOf } from '@/lib/adminEncouragement';

vi.mock('@/lib/turnstile', () => ({
  getTurnstileToken: vi.fn(() => Promise.resolve('turnstile-token-0123456789')),
}));

const SUPER_SESSION = {
  token: 'raw-admin-token',
  expiresAt: '2026-07-18T00:00:00.000Z',
  subject: { type: 'admin', id: 'adm-1', displayName: 'Kenecia', role: 'super_admin' },
};

const WEEK = mondayOf(new Date());

function dayDate(offset: number): string {
  const d = new Date(`${WEEK}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function draft(i: number, status = 'draft') {
  return {
    id: `msg-${String(i)}`,
    text: `Message ${String(i)} — you are crowned, queen.`,
    source: 'ai_generated',
    scheduledDate: dayDate(i),
    weekOf: WEEK,
    status,
    model: 'canned',
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Calls = Record<string, RequestInit[]>;

function stubFetch(
  routes: Record<string, (init?: RequestInit) => Response>,
  calls: Calls = {},
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (target.endsWith('/auth-login')) {
        return Promise.resolve(jsonResponse(SUPER_SESSION));
      }
      if (target.endsWith('/admin-dashboard')) {
        return Promise.resolve(
          jsonResponse({
            activeStudents: 0,
            newFlags: 0,
            highSeverityNewFlags: 0,
            todaysCrownChecks: 0,
            pending: {
              openFlags: 0,
              moderation: 0,
              guardianRequests: 0,
              encouragementDrafts: 0,
              upcomingEvents: 0,
            },
          }),
        );
      }
      for (const [suffix, respond] of Object.entries(routes)) {
        if (target.includes(suffix)) {
          (calls[suffix] ??= []).push(init ?? {});
          return Promise.resolve(respond(init));
        }
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    }),
  );
}

async function openSection(): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Mentor or admin? Sign in here' }));
  await user.type(screen.getByLabelText('Email'), 'kenecia@example.com');
  await user.type(screen.getByLabelText('PIN'), '123456');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  const nav = await screen.findByRole('navigation', { name: 'Admin sections' });
  await user.click(within(nav).getByRole('link', { name: 'Encouragement' }));
}

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
  window.history.replaceState(null, '', '/login');
});

afterEach(() => {
  resetAuthForTests();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Encouragement section (Phase 7)', () => {
  it('generates the week and renders seven day cards as drafts', async () => {
    let generated = false;
    stubFetch({
      'encouragement/rules': () => jsonResponse({ rules: [] }),
      'encouragement/generate': () => {
        generated = true;
        return jsonResponse({ messages: [0, 1, 2, 3, 4, 5, 6].map((i) => draft(i)) }, 201);
      },
      'encouragement?weekOf=': () =>
        jsonResponse({ messages: generated ? [0, 1, 2, 3, 4, 5, 6].map((i) => draft(i)) : [] }),
    });

    render(<App />);
    await openSection();

    // The human-gate promise is stated on the page.
    expect(
      await screen.findByText(/Nothing reaches the girls until you approve/),
    ).toBeInTheDocument();

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: "Generate this week's messages" }));

    expect(await screen.findByText('Message 0 — you are crowned, queen.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(7);
    expect(screen.getByText('Monday · ' + dayDate(0))).toBeInTheDocument();
    expect(screen.getByText('Sunday · ' + dayDate(6))).toBeInTheDocument();
  });

  it('captures the reason on a reject — the corrective loop input', async () => {
    const calls: Calls = {};
    stubFetch(
      {
        'encouragement/rules': () => jsonResponse({ rules: [] }),
        'encouragement/reject': () => jsonResponse({ status: 'rejected' }),
        'encouragement?weekOf=': () => jsonResponse({ messages: [draft(0)] }),
      },
      calls,
    );

    render(<App />);
    await openSection();
    await screen.findByText('Message 0 — you are crowned, queen.');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    await user.type(screen.getByLabelText(/Why\?/), 'too preachy for our girls');
    await user.click(screen.getByRole('button', { name: 'Confirm reject' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Rejected and recorded.');
    const body = calls['encouragement/reject']?.[0]?.body;
    if (typeof body !== 'string') {
      throw new Error('reject body was not a JSON string');
    }
    expect(JSON.parse(body)).toEqual({ messageId: 'msg-0', reason: 'too preachy for our girls' });
  });

  it('replaces a draft with her own words, reason required', async () => {
    const calls: Calls = {};
    stubFetch(
      {
        'encouragement/rules': () => jsonResponse({ rules: [] }),
        'encouragement/replace': () =>
          jsonResponse(
            {
              message: { ...draft(0), id: 'msg-own', source: 'admin_written', status: 'approved' },
            },
            201,
          ),
        'encouragement?weekOf=': () => jsonResponse({ messages: [draft(0)] }),
      },
      calls,
    );

    render(<App />);
    await openSection();
    await screen.findByText('Message 0 — you are crowned, queen.');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Write my own' }));

    const saveButton = screen.getByRole('button', { name: 'Save my message' });
    expect(saveButton).toBeDisabled(); // no reason yet

    await user.clear(screen.getByLabelText(/Your message/));
    await user.type(screen.getByLabelText(/Your message/), 'Queens rest too. See you Monday.');
    await user.type(screen.getByLabelText(/Why\?/), 'wanted my own voice for Monday');
    await user.click(saveButton);

    expect(await screen.findByRole('status')).toHaveTextContent('Replaced with your words');
    const body = calls['encouragement/replace']?.[0]?.body;
    if (typeof body !== 'string') {
      throw new Error('replace body was not a JSON string');
    }
    expect(JSON.parse(body)).toEqual({
      messageId: 'msg-0',
      text: 'Queens rest too. See you Monday.',
      reason: 'wanted my own voice for Monday',
    });
  });

  it('posts only when something is approved, and adds gateway rules', async () => {
    const calls: Calls = {};
    stubFetch(
      {
        'encouragement/rules/toggle': () => jsonResponse({ rule: { id: 'r-1', active: false } }),
        'encouragement/rules': (init) =>
          init?.method === 'POST'
            ? jsonResponse({ rule: { id: 'r-1' } }, 201)
            : jsonResponse({ rules: [{ id: 'r-1', text: 'No denominations', active: true }] }),
        'encouragement/post': () => jsonResponse({ posted: 2 }),
        'encouragement?weekOf=': () =>
          jsonResponse({ messages: [draft(0, 'approved'), draft(1, 'approved'), draft(2)] }),
      },
      calls,
    );

    render(<App />);
    await openSection();
    await screen.findByText('Message 0 — you are crowned, queen.');

    const user = userEvent.setup();
    const postButton = screen.getByRole('button', { name: 'Post approved (2)' });
    await user.click(postButton);
    expect(await screen.findByRole('status')).toHaveTextContent('Posted.');

    await user.type(screen.getByLabelText('New gateway rule'), 'Never reference diets');
    await user.click(screen.getByRole('button', { name: 'Add rule' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Rule added');
  });
});
