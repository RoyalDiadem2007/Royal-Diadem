/**
 * Admin shell tests driven through the real App: real router, real auth
 * store, real components. Only fetch (the network boundary) is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { resetAuthForTests } from '@/lib/authStore';

vi.mock('@/lib/turnstile', () => ({
  getTurnstileToken: vi.fn(() => Promise.resolve('turnstile-token-0123456789')),
}));

const ADMIN_SESSION_BODY = {
  token: 'raw-admin-token',
  expiresAt: '2026-07-18T00:00:00.000Z',
  subject: { type: 'admin', id: 'adm-1', displayName: 'Rosalyn', role: 'mentor' },
};

const STUDENT_SESSION_BODY = {
  token: 'raw-student-token',
  expiresAt: '2026-07-18T00:00:00.000Z',
  subject: { type: 'student', id: 'stu-1', displayName: 'Jada', role: 'student' },
};

const COUNTS_BODY = {
  activeStudents: 12,
  newFlags: 3,
  highSeverityNewFlags: 1,
  todaysCrownChecks: 7,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type FetchStub = {
  loginBody: unknown;
  dashboardResponses: Response[];
  dashboardCalls: RequestInit[];
};

function stubFetch(stub: FetchStub): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (target.endsWith('/auth-login')) {
        return Promise.resolve(jsonResponse(stub.loginBody));
      }
      if (target.endsWith('/admin-dashboard')) {
        stub.dashboardCalls.push(init ?? {});
        const next = stub.dashboardResponses.shift();
        return Promise.resolve(next ?? jsonResponse({ error: 'server_error' }, 500));
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    }),
  );
}

async function signIn(kind: 'admin' | 'student'): Promise<void> {
  const user = userEvent.setup();
  if (kind === 'admin') {
    await user.click(screen.getByRole('button', { name: 'Mentor or admin? Sign in here' }));
    await user.type(screen.getByLabelText('Email'), 'rosalyn@example.com');
  } else {
    await user.type(screen.getByLabelText('Crown code'), 'RD-7F3K');
  }
  await user.type(screen.getByLabelText('PIN'), '123456');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
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

describe('admin shell routing and dashboard', () => {
  it('routes an admin sign-in to the file cabinet and loads real counts', async () => {
    const stub: FetchStub = {
      loginBody: ADMIN_SESSION_BODY,
      dashboardResponses: [jsonResponse(COUNTS_BODY)],
      dashboardCalls: [],
    };
    stubFetch(stub);

    render(<App />);
    await signIn('admin');

    const nav = await screen.findByRole('navigation', { name: 'Admin sections' });
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Rosalyn')).toBeInTheDocument();
    expect(screen.getByText('Mentor')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('12')).toBeInTheDocument();
    });
    expect(screen.getByText('Active students')).toBeInTheDocument();
    expect(screen.getByText('New flags (1 high severity)')).toBeInTheDocument();
    expect(screen.getByText('Crown Checks today')).toBeInTheDocument();

    // The session token travels as a bearer header — never in the URL.
    const headers = new Headers(stub.dashboardCalls[0]?.headers);
    expect(headers.get('authorization')).toBe('Bearer raw-admin-token');
  });

  it('connects the Active students tile to the Students section for a super admin', async () => {
    const SUPER_SESSION = {
      ...ADMIN_SESSION_BODY,
      subject: { type: 'admin', id: 'adm-9', displayName: 'Kenecia', role: 'super_admin' },
    };
    const stub: FetchStub = {
      loginBody: SUPER_SESSION,
      dashboardResponses: [jsonResponse(COUNTS_BODY)],
      dashboardCalls: [],
    };
    stubFetch(stub);

    render(<App />);
    await signIn('admin');
    await screen.findByText('Active students');

    const tile = screen.getByRole('link', { name: /Active students/ });
    expect(tile).toHaveAttribute('href', '/admin/students');
    // Crown Checks shipped with Phase 5, so its tile is live too.
    expect(screen.getByRole('link', { name: /Crown Checks today/ })).toHaveAttribute(
      'href',
      '/admin/crown-checks',
    );
    // The flags tile links into the Flag Center (Phase 14).
    expect(screen.getByRole('link', { name: /New flags/ })).toHaveAttribute('href', '/admin/flags');

    await userEvent.setup().click(tile);
    expect(await screen.findByRole('heading', { name: 'Students' })).toBeInTheDocument();
  });

  it('keeps dashboard tiles plain for a mentor (no Students access until OD-6)', async () => {
    const stub: FetchStub = {
      loginBody: ADMIN_SESSION_BODY,
      dashboardResponses: [jsonResponse(COUNTS_BODY)],
      dashboardCalls: [],
    };
    stubFetch(stub);

    render(<App />);
    await signIn('admin');
    await screen.findByText('Active students');

    expect(screen.queryByRole('link', { name: /Active students/ })).not.toBeInTheDocument();
  });

  it('shows a calm error state and recovers via Try again', async () => {
    const stub: FetchStub = {
      loginBody: ADMIN_SESSION_BODY,
      dashboardResponses: [
        jsonResponse({ error: 'server_error' }, 500),
        jsonResponse({ ...COUNTS_BODY, highSeverityNewFlags: 0 }),
      ],
      dashboardCalls: [],
    };
    stubFetch(stub);

    render(<App />);
    await signIn('admin');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Couldn’t load the dashboard.');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => {
      expect(screen.getByText('Active students')).toBeInTheDocument();
    });
    // No high-severity flags → the plain label, no alert styling text.
    expect(screen.getByText('New flags')).toBeInTheDocument();
    expect(stub.dashboardCalls).toHaveLength(2);
  });

  it('keeps a student out of /admin (UX gate) even on a deep link', async () => {
    window.history.replaceState(null, '', '/admin');
    const stub: FetchStub = {
      loginBody: STUDENT_SESSION_BODY,
      dashboardResponses: [],
      dashboardCalls: [],
    };
    stubFetch(stub);

    render(<App />);
    await signIn('student');

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Welcome, Jada');
    });
    expect(screen.queryByRole('navigation', { name: 'Admin sections' })).not.toBeInTheDocument();
    expect(stub.dashboardCalls).toHaveLength(0);
  });

  it('signs an admin out back to the login screen', async () => {
    const stub: FetchStub = {
      loginBody: ADMIN_SESSION_BODY,
      dashboardResponses: [jsonResponse(COUNTS_BODY)],
      dashboardCalls: [],
    };
    stubFetch(stub);

    render(<App />);
    await signIn('admin');
    await screen.findByRole('navigation', { name: 'Admin sections' });

    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => {
      expect(screen.getByRole('form', { name: 'Sign in' })).toBeInTheDocument();
    });
  });
});
