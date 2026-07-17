/**
 * Landing page tests (OD-20) driven through the real App: real router, real
 * config. No network — the landing page is fully static.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { brand } from '@/config/branding.config';
import { resetAuthForTests } from '@/lib/authStore';

vi.mock('@/lib/turnstile', () => ({
  getTurnstileToken: vi.fn(() => Promise.resolve('turnstile-token-0123456789')),
}));

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  resetAuthForTests();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('public landing page (OD-20)', () => {
  it('is the front door: logo, founder photo, write-up — all from the branding config', () => {
    render(<App />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(brand.name);
    expect(screen.getByAltText(`${brand.name} logo`)).toHaveAttribute('src', brand.logo);

    const founderPhoto = screen.getByAltText(`${brand.founder.name}, ${brand.founder.title}`);
    expect(founderPhoto).toHaveAttribute('src', brand.founder.photo);
    expect(screen.getByText(new RegExp(brand.founder.name))).toBeInTheDocument();

    expect(screen.getByText(brand.landingBlurb)).toBeInTheDocument();

    // No sign-in form here — the landing page is content only.
    expect(screen.queryByRole('form', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('leads to the sign-in page through the bottom arrow', async () => {
    render(<App />);

    const arrow = screen.getByRole('link', { name: 'Continue to sign in' });
    expect(arrow).toHaveAttribute('href', '/login');

    await userEvent.setup().click(arrow);
    expect(await screen.findByRole('form', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('still sends unknown logged-out paths straight to sign-in (deep links)', () => {
    window.history.replaceState(null, '', '/admin');
    render(<App />);
    expect(screen.getByRole('form', { name: 'Sign in' })).toBeInTheDocument();
  });
});
