/**
 * Crown Checks admin section tests driven through the real App: real router,
 * real auth store, real components. Only fetch (the network boundary) is
 * mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { resetAuthForTests } from '@/lib/authStore';

vi.mock('@/lib/turnstile', () => ({
  getTurnstileToken: vi.fn(() => Promise.resolve('turnstile-token-0123456789')),
}));

const SUPER_SESSION_BODY = {
  token: 'raw-admin-token',
  expiresAt: '2026-07-18T00:00:00.000Z',
  subject: { type: 'admin', id: 'adm-1', displayName: 'Kenecia', role: 'super_admin' },
};

const COUNTS_BODY = {
  activeStudents: 2,
  newFlags: 1,
  highSeverityNewFlags: 1,
  todaysCrownChecks: 1,
  pending: {
    openFlags: 0,
    moderation: 0,
    guardianRequests: 0,
    encouragementDrafts: 0,
    sessionRequests: 0,
    friendInvites: 0,
    upcomingEvents: 0,
  },
};

const ROSTER_BODY = {
  students: [
    {
      studentId: 'stu-1',
      displayName: 'Amber',
      firstName: 'Amber',
      lastName: 'Brooks',
      lastCheck: { checkDate: '2026-07-17', moodScore: 2, moodEmoji: '😟' },
      recent: [
        { checkDate: '2026-07-17', moodScore: 2 },
        { checkDate: '2026-07-16', moodScore: 1 },
        { checkDate: '2026-07-15', moodScore: 2 },
      ],
      needsReview: true,
    },
    {
      studentId: 'stu-2',
      displayName: 'Nia',
      firstName: 'Nia',
      lastName: 'Carter',
      lastCheck: null,
      recent: [],
      needsReview: false,
    },
  ],
  page: 1,
  pageSize: 50,
  total: 2,
};

const AMBER_ID = '3f0d2a9c-6b1e-4f5a-8c7d-2e9b4a6c8d10';

/** One open crown-check flag whose section link deep-links to `studentId`. */
function flagsBody(studentId: string): unknown {
  return {
    flags: [
      {
        id: 'flag-1',
        source: 'ai',
        entityType: 'crown_check',
        severity: 'high',
        status: 'new',
        createdAt: '2026-07-18T15:00:00Z',
        resolvedAt: null,
        adminNotes: null,
        studentId,
        studentName: 'Amber',
        detail: 'Crown Check 2026-07-17 — 3 consecutive check-ins at or below 2',
        flaggedBy: null,
      },
    ],
    scope: 'open',
    page: 1,
    pageSize: 50,
    total: 1,
  };
}

const DETAIL_BODY = {
  student: {
    studentId: 'stu-1',
    displayName: 'Amber',
    firstName: 'Amber',
    lastName: 'Brooks',
    status: 'active',
    needsReview: true,
  },
  checks: [
    {
      id: 'chk-3',
      checkDate: '2026-07-17',
      moodScore: 2,
      moodEmoji: '😟',
      note: 'rough week',
      aiFlagTriggered: true,
      aiFlagReason: '3 consecutive check-ins at or below 2',
    },
    {
      id: 'chk-2',
      checkDate: '2026-07-16',
      moodScore: 1,
      moodEmoji: '😢',
      note: null,
      aiFlagTriggered: false,
      aiFlagReason: null,
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type FetchStub = {
  rosterResponses: Response[];
  detailResponses: Response[];
  /** Only the deep-link tests visit the Flag Center. */
  flagsResponses?: Response[];
  /** Detail request URLs, captured for deep-link assertions. */
  detailUrls?: string[];
};

function stubFetch(stub: FetchStub): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (target.endsWith('/auth-login')) {
        return Promise.resolve(jsonResponse(SUPER_SESSION_BODY));
      }
      if (target.endsWith('/admin-dashboard')) {
        return Promise.resolve(jsonResponse(COUNTS_BODY));
      }
      if (target.includes('/admin-flags')) {
        const next = stub.flagsResponses?.shift();
        return Promise.resolve(next ?? jsonResponse({ error: 'server_error' }, 500));
      }
      if (target.includes('/admin-crown-checks/student?studentId=')) {
        stub.detailUrls?.push(target);
        const next = stub.detailResponses.shift();
        return Promise.resolve(next ?? jsonResponse({ error: 'server_error' }, 500));
      }
      if (target.includes('/admin-crown-checks')) {
        const next = stub.rosterResponses.shift();
        return Promise.resolve(next ?? jsonResponse({ error: 'server_error' }, 500));
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    }),
  );
}

async function signInAndOpenSection(section = 'Crown Checks'): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Mentor or admin? Sign in here' }));
  await user.type(screen.getByLabelText('Email'), 'kenecia@example.com');
  await user.type(screen.getByLabelText('PIN'), '123456');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  const nav = await screen.findByRole('navigation', { name: 'Admin sections' });
  await user.click(within(nav).getByRole('link', { name: section }));
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

describe('admin Crown Checks section', () => {
  it('shows the roster with trends and a discreet tilted crown, never an alarm', async () => {
    const stub: FetchStub = { rosterResponses: [jsonResponse(ROSTER_BODY)], detailResponses: [] };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenSection();

    expect(await screen.findByText(/Brooks, Amber/)).toBeInTheDocument();
    expect(screen.getByText(/Carter, Nia/)).toBeInTheDocument();

    // The needs-review mark: exactly one, and worded as a gentle invitation.
    const marks = screen.getAllByRole('img', { name: 'Needs a gentle check-in' });
    expect(marks).toHaveLength(1);

    // A student with no check-ins reads calmly, not as an error.
    expect(screen.getByText('No check-ins yet')).toBeInTheDocument();
  });

  it('opens a student detail with her notes and the flag reason', async () => {
    const stub: FetchStub = {
      rosterResponses: [jsonResponse(ROSTER_BODY)],
      detailResponses: [jsonResponse(DETAIL_BODY)],
    };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenSection();
    await screen.findByText(/Brooks, Amber/);

    const user = userEvent.setup();
    const [viewButton] = screen.getAllByRole('button', { name: 'View check-ins' });
    if (viewButton === undefined) {
      throw new Error('no View check-ins button rendered');
    }
    await user.click(viewButton);

    expect(await screen.findByRole('heading', { name: /Amber/ })).toBeInTheDocument();
    expect(screen.getByText('rough week')).toBeInTheDocument();
    expect(screen.getByText(/3 consecutive check-ins at or below 2/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back to all students' }));
    expect(await screen.findByText(/Carter, Nia/)).toBeInTheDocument();
  });

  it('shows a calm error state and recovers via Try again', async () => {
    const stub: FetchStub = {
      rosterResponses: [jsonResponse({ error: 'server_error' }, 500), jsonResponse(ROSTER_BODY)],
      detailResponses: [],
    };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenSection();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Couldn’t load Crown Check trends.');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(screen.getByText(/Brooks, Amber/)).toBeInTheDocument();
    });
  });

  it('deep-links from a Flag Center row straight into the student’s check-ins', async () => {
    const stub: FetchStub = {
      rosterResponses: [jsonResponse(ROSTER_BODY)],
      detailResponses: [jsonResponse(DETAIL_BODY)],
      flagsResponses: [jsonResponse(flagsBody(AMBER_ID))],
      detailUrls: [],
    };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenSection('Flags');

    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'Open Crown Checks' }));

    // Her notes and flag reason appear without hunting through the roster.
    expect(await screen.findByText('rough week')).toBeInTheDocument();
    expect(screen.getByText(/3 consecutive check-ins at or below 2/)).toBeInTheDocument();
    expect(stub.detailUrls?.[0]).toContain(`studentId=${AMBER_ID}`);

    // Back lands on the full roster, deep link cleared.
    await user.click(screen.getByRole('button', { name: 'Back to all students' }));
    expect(await screen.findByText(/Carter, Nia/)).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });

  it('ignores a mangled deep link and shows the roster', async () => {
    const stub: FetchStub = {
      rosterResponses: [jsonResponse(ROSTER_BODY)],
      detailResponses: [],
      flagsResponses: [jsonResponse(flagsBody('not-a-uuid'))],
      detailUrls: [],
    };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenSection('Flags');

    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'Open Crown Checks' }));

    expect(await screen.findByText(/Brooks, Amber/)).toBeInTheDocument();
    // No doomed detail request went out, and the URL was cleaned up.
    expect(stub.detailUrls).toHaveLength(0);
    expect(window.location.search).toBe('');
  });

  it('treats a malformed roster body as an error, never a crash', async () => {
    const stub: FetchStub = {
      rosterResponses: [jsonResponse({ students: 'nope' })],
      detailResponses: [],
    };
    stubFetch(stub);

    render(<App />);
    await signInAndOpenSection();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Couldn’t load Crown Check trends.');
  });
});
