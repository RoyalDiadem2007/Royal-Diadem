/**
 * Journals admin section tests through the real App. Only fetch is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { resetAuthForTests } from '@/lib/authStore';

vi.mock('@/lib/turnstile', () => ({
  getTurnstileToken: vi.fn(() => Promise.resolve('turnstile-token-0123456789')),
}));

const SUPER_SESSION = {
  token: 'raw-admin-token',
  expiresAt: '2026-07-18T00:00:00.000Z',
  subject: { type: 'admin', id: 'adm-1', displayName: 'Kenecia', role: 'super_admin' },
};

const ROSTER_BODY = {
  students: [
    {
      studentId: 'stu-1',
      displayName: 'Maya',
      firstName: 'Maya',
      lastName: 'Linked',
      entryCount: 2,
      lastEntryAt: '2026-07-17T20:00:00.000Z',
      needsReview: true,
    },
  ],
  page: 1,
  pageSize: 50,
  total: 1,
};

const DETAIL_BODY = {
  student: { studentId: 'stu-1', displayName: 'Maya' },
  entries: [
    {
      id: 'e-1',
      promptText: null,
      text: 'a hard week at home',
      aiFlagTriggered: true,
      aiFlagReason: 'journal pattern match: possible abuse',
      createdAt: '2026-07-17T20:00:00.000Z',
    },
  ],
};

const PROMPTS_BODY = {
  prompts: [{ id: 'p-1', text: 'What made you feel strong?', active: true }],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch(routes: Record<string, (init?: RequestInit) => Response>): void {
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
            activeStudents: 1,
            newFlags: 1,
            highSeverityNewFlags: 1,
            todaysCrownChecks: 0,
            pending: {
              openFlags: 0,
              moderation: 0,
              guardianRequests: 0,
              encouragementDrafts: 0,
              sessionRequests: 0,
              friendInvites: 0,
              upcomingEvents: 0,
            },
          }),
        );
      }
      for (const [suffix, respond] of Object.entries(routes)) {
        if (target.includes(suffix)) {
          return Promise.resolve(respond(init));
        }
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    }),
  );
}

async function openJournals(): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Mentor or admin? Sign in here' }));
  await user.type(screen.getByLabelText('Email'), 'kenecia@example.com');
  await user.type(screen.getByLabelText('PIN'), '123456');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  const nav = await screen.findByRole('navigation', { name: 'Admin sections' });
  await user.click(within(nav).getByRole('link', { name: 'Journals' }));
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

describe('admin Journals section (Phase 6)', () => {
  it('shows the roster with the discreet review mark and opens decrypted entries', async () => {
    stubFetch({
      'admin-journal/student?studentId=': () => jsonResponse(DETAIL_BODY),
      'admin-journal/prompts': () => jsonResponse(PROMPTS_BODY),
      'admin-journal?page=': () => jsonResponse(ROSTER_BODY),
    });

    render(<App />);
    await openJournals();

    expect(await screen.findByText(/Linked, Maya/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Needs a gentle check-in' })).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Read entries' }));

    expect(await screen.findByText('a hard week at home')).toBeInTheDocument();
    // The flag reason is the CATEGORY, never the matched words.
    expect(screen.getByText(/journal pattern match: possible abuse/)).toBeInTheDocument();
  });

  it('manages prompts: add and retire', async () => {
    let created = false;
    stubFetch({
      'admin-journal/prompts/toggle': () => jsonResponse({ prompt: { id: 'p-1', active: false } }),
      'admin-journal/prompts': (init) => {
        if (init?.method === 'POST') {
          created = true;
          return jsonResponse({ prompt: { id: 'p-2' } }, 201);
        }
        return created
          ? jsonResponse({
              prompts: [
                { id: 'p-1', text: 'What made you feel strong?', active: true },
                { id: 'p-2', text: 'Who cheered for you today?', active: true },
              ],
            })
          : jsonResponse(PROMPTS_BODY);
      },
      'admin-journal?page=': () => jsonResponse(ROSTER_BODY),
    });

    render(<App />);
    await openJournals();
    await screen.findByText('What made you feel strong?');

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('New prompt'), 'Who cheered for you today?');
    await user.click(screen.getByRole('button', { name: 'Add prompt' }));
    expect(await screen.findByText('Who cheered for you today?')).toBeInTheDocument();

    const [retireButton] = screen.getAllByRole('button', { name: 'Retire' });
    if (retireButton === undefined) {
      throw new Error('no Retire button rendered');
    }
    await user.click(retireButton);
    expect(await screen.findByText('What made you feel strong?')).toBeInTheDocument();
  });
});
