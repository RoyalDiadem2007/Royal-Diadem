/**
 * About page tests driven through the real App — including the signed-out
 * path from the public landing page, which is the page's whole point.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { resetAuthForTests } from '@/lib/authStore';

const SECTIONS = [
  {
    section: 'about_org',
    title: 'Royal Diadem Rise',
    body: 'A place where young women are crowned on purpose.',
  },
  {
    section: 'pastor_bio',
    title: 'Pastor Kenecia Duncan',
    body: 'Founder, shepherd, and the first to call every girl a queen.',
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch(aboutResponses: Response[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: RequestInfo | URL) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (target.includes('/rest/v1/about_content')) {
        const next = aboutResponses.shift();
        return Promise.resolve(next ?? jsonResponse([]));
      }
      if (target.includes('/rest/v1/')) {
        return Promise.resolve(jsonResponse([]));
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    }),
  );
}

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

describe('the public About page', () => {
  it('opens from the landing page without signing in', async () => {
    stubFetch([jsonResponse(SECTIONS)]);

    render(<App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('link', { name: /About Royal Diadem/ }));

    expect(await screen.findByText(/crowned on purpose/)).toBeInTheDocument();
    expect(screen.getByText(/first to call every girl a queen/)).toBeInTheDocument();
    const portrait = screen.getByRole('img', { name: 'Pastor Kenecia Duncan' });
    expect(portrait).toHaveAttribute('src', '/assets/kenecia-headshot-web.jpg');
  });

  it('stays warm when the sections are not written yet', async () => {
    stubFetch([jsonResponse([])]);

    render(<App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('link', { name: /About Royal Diadem/ }));

    expect(await screen.findByText(/Our story is still being written/)).toBeInTheDocument();
    expect(screen.getByText(/Pastor Kenecia’s story is on its way/)).toBeInTheDocument();
    // The portrait is present even before the words arrive.
    expect(screen.getByRole('img', { name: 'Pastor Kenecia Duncan' })).toBeInTheDocument();
  });

  it('offers a retry when the content cannot load', async () => {
    stubFetch([new Response(null, { status: 500 }), jsonResponse(SECTIONS)]);

    render(<App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('link', { name: /About Royal Diadem/ }));

    await screen.findByText(/Our story couldn’t load/);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/crowned on purpose/)).toBeInTheDocument();
  });
});
