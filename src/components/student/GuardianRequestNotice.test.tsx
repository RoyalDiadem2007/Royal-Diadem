/**
 * Student-side consent notice tests through the real App. Only fetch is
 * mocked. The card is the transparency mechanism: it must show exactly when a
 * pending request exists, and nothing at all otherwise.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { resetAuthForTests } from '@/lib/authStore';

vi.mock('@/lib/turnstile', () => ({
  getTurnstileToken: vi.fn(() => Promise.resolve('turnstile-token-0123456789')),
}));

const STUDENT_SESSION = {
  token: 'raw-student-token',
  expiresAt: '2026-07-18T00:00:00.000Z',
  subject: { type: 'student', id: 'stu-1', displayName: 'Maya', role: 'student' },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch(requestsBody: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (target.endsWith('/auth-login')) {
        return Promise.resolve(jsonResponse(STUDENT_SESSION));
      }
      if (target.endsWith('/student-guardian-requests')) {
        return Promise.resolve(jsonResponse(requestsBody));
      }
      if (target.endsWith('/crown-check')) {
        return Promise.resolve(jsonResponse({ today: null, recent: [] }));
      }
      if (target.includes('/rest/v1/')) {
        // Empty Data API reads — the passive content cards stay hidden.
        return Promise.resolve(jsonResponse([]));
      }
      if (target.endsWith('/student-profile')) {
        // The goals card stays in its gentle empty state.
        return Promise.resolve(
          jsonResponse({
            profile: { avatarKey: null, proudOf: null },
            goals: [],
            strengths: [],
            strengthOptions: [],
          }),
        );
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    }),
  );
}

async function signIn(): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Crown code'), 'RD-7F3K');
  await user.type(screen.getByLabelText('PIN'), '123456');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByRole('heading', { name: /Maya/ });
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

describe('guardian request notice (student side, OD-19)', () => {
  it('shows the request and the code as HER choice to share', async () => {
    stubFetch({
      requests: [
        {
          id: 'req-1',
          guardianName: 'Rae Linked',
          code: '135791',
          expiresAt: new Date(Date.now() + 9 * 60_000).toISOString(),
        },
      ],
    });

    render(<App />);
    await signIn();

    const card = await screen.findByLabelText('Rae Linked is asking to view your account');
    expect(card).toHaveTextContent('Nothing opens unless you share this code');
    expect(card).toHaveTextContent('it’s your call');
    expect(screen.getByText('135791')).toBeInTheDocument();
  });

  it('renders nothing at all when no request is pending', async () => {
    stubFetch({ requests: [] });

    render(<App />);
    await signIn();

    expect(screen.queryByText(/asking to look at your account/)).not.toBeInTheDocument();
  });
});
