import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { brand } from '@/config/branding.config';
import { resetAuthForTests } from '@/lib/authStore';

vi.mock('@/lib/turnstile', () => ({
  getTurnstileToken: vi.fn(() => Promise.resolve('turnstile-token-0123456789')),
}));

const SESSION_BODY = {
  token: 'raw-opaque-token',
  expiresAt: '2026-07-17T00:00:00.000Z',
  subject: { type: 'student', id: 'stu-1', displayName: 'Jada', role: 'student' },
};

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
});

afterEach(() => {
  resetAuthForTests();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('App auth gate (white-label)', () => {
  it('opens on the branded landing page, with sign-in one arrow away (OD-20)', async () => {
    window.history.replaceState(null, '', '/');
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(brand.name);
    expect(screen.queryByRole('form', { name: 'Sign in' })).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('link', { name: 'Continue to sign in' }));
    expect(await screen.findByRole('form', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('signs in end-to-end, shows the welcome, and signs out again', async () => {
    window.history.replaceState(null, '', '/login');
    vi.stubGlobal(
      'fetch',
      vi.fn((url: RequestInfo | URL) => {
        const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
        if (target.endsWith('/auth-login')) {
          return Promise.resolve(
            new Response(JSON.stringify(SESSION_BODY), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
        if (target.includes('/rest/v1/encouragement_messages')) {
          // No message posted today — the daily card stays hidden.
          return Promise.resolve(
            new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }),
          );
        }
        return Promise.resolve(new Response(null, { status: 204 }));
      }),
    );

    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText('Crown code'), 'RD-7F3K');
    await user.type(screen.getByLabelText('PIN'), '123456');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Welcome, Jada');
    });

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    // Signing out lands on the public front door (OD-20), one arrow from
    // sign-in — not straight back onto the form.
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Continue to sign in' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('form', { name: 'Sign in' })).not.toBeInTheDocument();
  });
});
