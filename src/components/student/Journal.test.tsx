/**
 * Student journal tests through the real App. Only fetch is mocked. The
 * transparency line is asserted — it is product, not decoration.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { resetAuthForTests } from '@/lib/authStore';

vi.mock('@/lib/turnstile', () => ({
  getTurnstileToken: vi.fn(() => Promise.resolve('turnstile-token-0123456789')),
}));

const SESSION = {
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

type FetchStub = {
  homeResponses: Response[];
  writeResponses: Response[];
  writeCalls: RequestInit[];
};

function stubFetch(stub: FetchStub): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (target.endsWith('/auth-login')) {
        return Promise.resolve(jsonResponse(SESSION));
      }
      if (target.endsWith('/journal')) {
        if (init?.method === 'POST') {
          stub.writeCalls.push(init);
          const next = stub.writeResponses.shift();
          return Promise.resolve(next ?? jsonResponse({ error: 'server_error' }, 500));
        }
        const next = stub.homeResponses.shift();
        return Promise.resolve(next ?? jsonResponse({ error: 'server_error' }, 500));
      }
      if (target.endsWith('/crown-check')) {
        return Promise.resolve(jsonResponse({ today: null, recent: [] }));
      }
      if (target.includes('/rest/v1/')) {
        // Empty Data API reads — the passive content cards stay hidden.
        return Promise.resolve(jsonResponse([]));
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
  // The journal lives in its own room — one tap on the tab bar.
  const mainNav = await screen.findByRole('navigation', { name: 'Main' });
  await user.click(within(mainNav).getByRole('link', { name: 'Journal' }));
  await screen.findByRole('heading', { name: 'My Journal' });
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

describe('student journal (Phase 6)', () => {
  it('writes an entry (with a prompt) and states the transparency deal', async () => {
    const stub: FetchStub = {
      homeResponses: [
        jsonResponse({
          prompts: [{ id: '00000000-0000-4000-8000-000000000001', text: 'What made you smile?' }],
          entries: [],
        }),
        jsonResponse({
          prompts: [{ id: '00000000-0000-4000-8000-000000000001', text: 'What made you smile?' }],
          entries: [
            {
              id: 'e-1',
              promptText: 'What made you smile?',
              text: 'my little sister',
              createdAt: '2026-07-17T20:00:00.000Z',
            },
          ],
        }),
      ],
      writeResponses: [
        jsonResponse({ entry: { id: 'e-1', createdAt: '2026-07-17T20:00:00.000Z' } }, 201),
      ],
      writeCalls: [],
    };
    stubFetch(stub);

    render(<App />);
    await signIn();

    // The transparency line — she knows her mentor reads this.
    expect(await screen.findByText(/Your mentor can read what you write here/)).toBeInTheDocument();

    // Writing support: on-device spelling help enabled, dictation nudge shown.
    const journalBox = screen.getByLabelText(/What’s in your heart today\?/);
    expect(journalBox).toHaveAttribute('spellcheck', 'true');
    expect(journalBox).toHaveAttribute('autocorrect', 'on');
    expect(journalBox).toHaveAttribute('autocapitalize', 'sentences');
    expect(screen.getByText(/Tap the microphone on your keyboard/)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.selectOptions(
      await screen.findByLabelText(/Want a prompt/),
      '00000000-0000-4000-8000-000000000001',
    );
    await user.type(screen.getByLabelText(/What’s in your heart today\?/), 'my little sister');
    await user.click(screen.getByRole('button', { name: 'Save entry' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Your words are safe here');
    const body = stub.writeCalls[0]?.body;
    if (typeof body !== 'string') {
      throw new Error('write body was not a JSON string');
    }
    expect(JSON.parse(body)).toEqual({
      text: 'my little sister',
      promptId: '00000000-0000-4000-8000-000000000001',
    });

    // History refreshed with her entry.
    await user.click(await screen.findByText(/Your past entries \(1\)/));
    expect(screen.getByText('my little sister')).toBeInTheDocument();
  });

  it('keeps the save button disabled for empty text and surfaces write failures', async () => {
    const stub: FetchStub = {
      homeResponses: [jsonResponse({ prompts: [], entries: [] })],
      writeResponses: [jsonResponse({ error: 'server_error' }, 500)],
      writeCalls: [],
    };
    stubFetch(stub);

    render(<App />);
    await signIn();
    await screen.findByText(/Your mentor can read what you write here/);

    const save = screen.getByRole('button', { name: 'Save entry' });
    expect(save).toBeDisabled();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/What’s in your heart today\?/), 'hello');
    await user.click(save);
    expect(await screen.findByRole('status')).toHaveTextContent("Couldn't save your entry");
  });
});
