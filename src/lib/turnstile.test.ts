import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTurnstileToken, type TurnstileApi, type TurnstileRenderOptions } from '@/lib/turnstile';

beforeEach(() => {
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '1x00000000000000000000AA');
});

afterEach(() => {
  delete window.turnstile;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function installFakeTurnstile(behavior: 'succeed' | 'fail'): TurnstileApi {
  const api: TurnstileApi = {
    render: vi.fn((_el: HTMLElement, options: TurnstileRenderOptions) => {
      queueMicrotask(() => {
        if (behavior === 'succeed') {
          options.callback('tok-abc123');
        } else {
          options['error-callback']();
        }
      });
      return 'widget-1';
    }),
    remove: vi.fn(),
  };
  window.turnstile = api;
  return api;
}

describe('getTurnstileToken', () => {
  it('renders an invisible widget and resolves with the token', async () => {
    const api = installFakeTurnstile('succeed');

    const token = await getTurnstileToken();

    expect(token).toBe('tok-abc123');
    // Widget and container are cleaned up after use (single-use tokens).
    expect(api.remove).toHaveBeenCalledWith('widget-1');
    expect(document.querySelectorAll('div[style]').length).toBe(0);
  });

  it('rejects when the challenge reports an error', async () => {
    installFakeTurnstile('fail');

    await expect(getTurnstileToken()).rejects.toThrow('Turnstile challenge failed');
  });

  it('passes the configured site key to the widget', async () => {
    const api = installFakeTurnstile('succeed');

    await getTurnstileToken();

    const renderMock = vi.mocked(api.render);
    const options = renderMock.mock.calls[0]?.[1];
    expect(options?.sitekey).toBe('1x00000000000000000000AA');
  });
});
