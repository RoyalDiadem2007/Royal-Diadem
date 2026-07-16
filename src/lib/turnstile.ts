/**
 * Cloudflare Turnstile client integration. The widget produces a short-lived
 * token the server verifies (docs/SUPABASE_RULES.md §6) — this module only
 * obtains tokens; it never decides anything security-relevant itself.
 */
import { turnstileSiteKey } from '@/config/env.config';

export type TurnstileRenderOptions = {
  sitekey: string;
  callback: (token: string) => void;
  'error-callback': () => void;
  appearance: 'always' | 'execute' | 'interaction-only';
};

export type TurnstileApi = {
  render: (element: HTMLElement, options: TurnstileRenderOptions) => string;
  remove: (widgetId: string) => void;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- global augmentation requires interface merging
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
const TOKEN_TIMEOUT_MS = 30_000;

let scriptLoading: Promise<void> | null = null;

function ensureScript(): Promise<void> {
  if (window.turnstile !== undefined) {
    return Promise.resolve();
  }
  scriptLoading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => {
      resolve();
    };
    script.onerror = () => {
      scriptLoading = null;
      reject(new Error('Turnstile script failed to load'));
    };
    document.head.appendChild(script);
  });
  return scriptLoading;
}

/** Renders an invisible challenge and resolves with a single-use token. */
export async function getTurnstileToken(): Promise<string> {
  await ensureScript();
  const api = window.turnstile;
  if (api === undefined) {
    throw new Error('Turnstile script loaded but API is unavailable');
  }

  const container = document.createElement('div');
  container.style.display = 'none';
  document.body.appendChild(container);

  return new Promise<string>((resolve, reject) => {
    let widgetId: string | null = null;
    const cleanup = (): void => {
      window.clearTimeout(timer);
      if (widgetId !== null) {
        api.remove(widgetId);
      }
      container.remove();
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('Turnstile challenge timed out'));
    }, TOKEN_TIMEOUT_MS);

    widgetId = api.render(container, {
      sitekey: turnstileSiteKey(),
      appearance: 'interaction-only',
      callback: (token) => {
        cleanup();
        resolve(token);
      },
      'error-callback': () => {
        cleanup();
        reject(new Error('Turnstile challenge failed'));
      },
    });
  });
}
