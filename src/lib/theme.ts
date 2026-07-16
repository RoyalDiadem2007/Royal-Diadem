import { brand } from '@/config/branding.config';

const SYSTEM_FONT_STACK =
  "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

function camelToKebab(value: string): string {
  return value.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

/**
 * Writes the branding config onto the document as CSS custom properties.
 * Components style themselves with `var(--color-*)` / `var(--font-*)` so the
 * white-label rule (Spec §3) holds: no component ever hardcodes a brand value.
 */
export function applyBrandTheme(root: HTMLElement = document.documentElement): void {
  for (const [key, value] of Object.entries(brand.colors)) {
    root.style.setProperty(`--color-${camelToKebab(key)}`, value);
  }
  root.style.setProperty(
    '--font-display',
    brand.fonts.display === '' ? SYSTEM_FONT_STACK : brand.fonts.display,
  );
  root.style.setProperty(
    '--font-body',
    brand.fonts.body === '' ? SYSTEM_FONT_STACK : brand.fonts.body,
  );
}
