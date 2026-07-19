/**
 * Students section tests driven through the real App: real router, real auth
 * store, real components. Only fetch (the network boundary) is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { resetAuthForTests } from '@/lib/authStore';

vi.mock('@/lib/turnstile', () => ({
  getTurnstileToken: vi.fn(() => Promise.resolve('turnstile-token-0123456789')),
}));

const SUPER_ADMIN_SESSION = {
  token: 'raw-super-admin-token',
  expiresAt: '2026-07-18T00:00:00.000Z',
  subject: { type: 'admin', id: 'adm-1', displayName: 'Kenecia', role: 'super_admin' },
};

const MENTOR_SESSION = {
  token: 'raw-mentor-token',
  expiresAt: '2026-07-18T00:00:00.000Z',
  subject: { type: 'admin', id: 'adm-2', displayName: 'Rosalyn', role: 'mentor' },
};

const COUNTS_BODY = {
  activeStudents: 1,
  newFlags: 0,
  highSeverityNewFlags: 0,
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
};

const STUDENT_AVA = {
  id: 'stu-1',
  firstName: 'Ava',
  lastName: 'Example',
  displayName: 'Ava',
  loginCode: 'RD-7F3K',
  status: 'active',
  coppaRequired: false,
  coppaConsentStatus: 'pending',
  phase: 'Phase 1',
  enrollmentDate: '2026-07-01T00:00:00.000Z',
};

const STUDENT_ZOE = {
  id: 'stu-2',
  firstName: 'Zoe',
  lastName: 'Little',
  displayName: 'Zoe',
  loginCode: 'RD-9Q2M',
  status: 'active',
  coppaRequired: true,
  coppaConsentStatus: 'pending',
  phase: null,
  enrollmentDate: '2026-07-10T00:00:00.000Z',
};

function rosterBody(students: unknown[]): unknown {
  return { students, page: 1, pageSize: 50, total: students.length };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Routes = Record<string, () => Response>;

/** Later entries win: routes are matched by "the url ends with the key". */
function stubFetch(session: unknown, routes: Routes): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (target.endsWith('/auth-login')) {
        return Promise.resolve(jsonResponse(session));
      }
      if (target.endsWith('/admin-dashboard')) {
        return Promise.resolve(jsonResponse(COUNTS_BODY));
      }
      for (const [suffix, respond] of Object.entries(routes)) {
        if (target.endsWith(suffix)) {
          return Promise.resolve(respond());
        }
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    }),
  );
}

async function signInAsAdmin(): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Mentor or admin? Sign in here' }));
  await user.type(screen.getByLabelText('Email'), 'admin@example.com');
  await user.type(screen.getByLabelText('PIN'), '123456');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByRole('navigation', { name: 'Admin sections' });
}

async function openStudentsSection(): Promise<void> {
  await signInAsAdmin();
  await userEvent.setup().click(screen.getByRole('link', { name: 'Students' }));
  await screen.findByRole('heading', { name: 'Students' });
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

describe('Students section', () => {
  it('hides the section from mentors until OD-6 lands', async () => {
    stubFetch(MENTOR_SESSION, {});
    render(<App />);
    await signInAsAdmin();
    expect(screen.queryByRole('link', { name: 'Students' })).not.toBeInTheDocument();
  });

  it('shows the roster with COPPA standing for a super admin', async () => {
    stubFetch(SUPER_ADMIN_SESSION, {
      'admin-students?page=1': () => jsonResponse(rosterBody([STUDENT_AVA, STUDENT_ZOE])),
    });
    render(<App />);
    await openStudentsSection();

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Example, Ava')).toBeInTheDocument();
    expect(within(table).getByText('RD-7F3K')).toBeInTheDocument();
    expect(within(table).getByText('Not required')).toBeInTheDocument();
    expect(within(table).getByText('Consent pending')).toBeInTheDocument();
  });

  it('shows the empty state before any enrollment', async () => {
    stubFetch(SUPER_ADMIN_SESSION, {
      'admin-students?page=1': () => jsonResponse(rosterBody([])),
    });
    render(<App />);
    await openStudentsSection();

    expect(await screen.findByText(/No students enrolled yet/)).toBeInTheDocument();
  });

  it('enrolls a student and shows the one-time PIN card with the COPPA lock note', async () => {
    let enrolled = false;
    stubFetch(SUPER_ADMIN_SESSION, {
      'admin-students/create': () => {
        enrolled = true;
        return jsonResponse({ student: STUDENT_ZOE, pin: '042917' }, 201);
      },
      'admin-students?page=1': () => jsonResponse(rosterBody(enrolled ? [STUDENT_ZOE] : [])),
    });
    render(<App />);
    await openStudentsSection();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add student' }));
    const form = screen.getByRole('form', { name: 'Add student' });
    await user.type(within(form).getByLabelText('First name'), 'Zoe');
    await user.type(within(form).getByLabelText('Last name'), 'Little');
    await user.type(within(form).getByLabelText('Display name'), 'Zoe');
    await user.type(within(form).getByLabelText('Date of birth'), '2014-09-15');
    await user.click(within(form).getByRole('button', { name: 'Enroll student' }));

    const card = await screen.findByRole('status');
    expect(card).toHaveTextContent('Zoe is enrolled');
    expect(card).toHaveTextContent('RD-9Q2M');
    expect(card).toHaveTextContent('042917');
    expect(card).toHaveTextContent('shown only this once');
    expect(card).toHaveTextContent('under 13');

    await user.click(screen.getByRole('button', { name: 'Done — card written' }));
    expect(screen.queryByText('042917')).not.toBeInTheDocument();
  });

  it('resets a PIN behind an explicit confirm and shows the new PIN once', async () => {
    stubFetch(SUPER_ADMIN_SESSION, {
      'admin-students?page=1': () => jsonResponse(rosterBody([STUDENT_AVA])),
      'admin-students/reset-pin': () => jsonResponse({ student: STUDENT_AVA, pin: '731045' }),
    });
    render(<App />);
    await openStudentsSection();
    await screen.findByRole('table');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Reset PIN' }));
    // Nothing happens until the explicit confirm.
    expect(screen.queryByText('731045')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm reset' }));

    const card = await screen.findByRole('status');
    expect(card).toHaveTextContent('New PIN for Ava');
    expect(card).toHaveTextContent('731045');
  });

  it('backs out of a reset without calling the server', async () => {
    const resetCalls: number[] = [];
    stubFetch(SUPER_ADMIN_SESSION, {
      'admin-students?page=1': () => jsonResponse(rosterBody([STUDENT_AVA])),
      'admin-students/reset-pin': () => {
        resetCalls.push(1);
        return jsonResponse({ student: STUDENT_AVA, pin: '000000' });
      },
    });
    render(<App />);
    await openStudentsSection();
    await screen.findByRole('table');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Reset PIN' }));
    await user.click(screen.getByRole('button', { name: 'Keep PIN' }));
    expect(resetCalls).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Reset PIN' })).toBeInTheDocument();
  });

  it('shows a calm error state when the roster fails to load', async () => {
    stubFetch(SUPER_ADMIN_SESSION, {
      'admin-students?page=1': () => jsonResponse({ error: 'server_error' }, 500),
    });
    render(<App />);
    await openStudentsSection();

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the roster.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('emails a welcome link and reports whose inbox it went to (OD-19)', async () => {
    stubFetch(SUPER_ADMIN_SESSION, {
      'admin-students?page=1': () => jsonResponse(rosterBody([STUDENT_ZOE])),
      'admin-students/send-link': () =>
        jsonResponse({ sent: true, recipient: 'guardian', expiresAt: '2026-07-20T00:00:00.000Z' }),
    });
    render(<App />);
    await openStudentsSection();
    await screen.findByText(/Little, Zoe/);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Email link' }));

    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent('Welcome link for Zoe sent to the guardian');
    expect(notice).toHaveTextContent('expires in 72 hours');
  });

  it('explains exactly why a link cannot be sent', async () => {
    stubFetch(SUPER_ADMIN_SESSION, {
      'admin-students?page=1': () => jsonResponse(rosterBody([STUDENT_ZOE])),
      'admin-students/send-link': () => jsonResponse({ error: 'no_guardian_email' }, 409),
    });
    render(<App />);
    await openStudentsSection();
    await screen.findByText(/Little, Zoe/);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Email link' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'No guardian email on file — add the guardian first.',
    );
  });

  it('invites a guardian to the portal and refuses 16+ students with the reason', async () => {
    stubFetch(SUPER_ADMIN_SESSION, {
      'admin-students?page=1': () => jsonResponse(rosterBody([STUDENT_AVA, STUDENT_ZOE])),
      'admin-students/invite-guardian': (() => {
        let call = 0;
        return () => {
          call += 1;
          return call === 1
            ? jsonResponse({ sent: true, expiresAt: '2026-07-20T00:00:00.000Z' })
            : jsonResponse({ error: 'not_eligible' }, 409);
        };
      })(),
    });
    render(<App />);
    await openStudentsSection();
    await screen.findByText(/Little, Zoe/);

    const user = userEvent.setup();
    const [firstInvite, secondInvite] = screen.getAllByRole('button', { name: 'Invite guardian' });
    if (firstInvite === undefined || secondInvite === undefined) {
      throw new Error('expected two Invite guardian buttons');
    }
    await user.click(firstInvite);
    expect(await screen.findByRole('status')).toHaveTextContent('portal invitation');

    await user.click(secondInvite);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Students 16 and up don’t have guardian portal access',
    );
  });

  it('grants emergency access only behind an explicit confirm, and says it is audited', async () => {
    stubFetch(SUPER_ADMIN_SESSION, {
      'admin-students?page=1': () => jsonResponse(rosterBody([STUDENT_ZOE])),
      'admin-students/emergency-access': () =>
        jsonResponse({ granted: true, accessExpiresAt: '2026-07-17T21:00:00.000Z' }, 201),
    });
    render(<App />);
    await openStudentsSection();
    await screen.findByText(/Little, Zoe/);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Emergency access' }));
    // Nothing granted yet — an explicit confirm stands between.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm emergency access' }));
    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent('open for 60 minutes');
    expect(notice).toHaveTextContent('The student is not notified');
    expect(notice).toHaveTextContent('fully audited');
  });
});
