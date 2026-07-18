import { describe, expect, it } from 'vitest';
import { brand } from '@/config/branding.config';
import { applyBrandTheme } from '@/lib/theme';

describe('applyBrandTheme', () => {
  it('sets a CSS custom property for every brand color, kebab-cased', () => {
    const root = document.createElement('div');
    applyBrandTheme(root);

    // jsdom normalizes hex casing, so compare case-insensitively.
    const cssVar = (name: string) => root.style.getPropertyValue(name).toLowerCase();
    expect(cssVar('--color-primary')).toBe(brand.colors.primary.toLowerCase());
    expect(cssVar('--color-text-primary')).toBe(brand.colors.textPrimary.toLowerCase());
    expect(cssVar('--color-crown-gold')).toBe(brand.colors.crownGold.toLowerCase());

    for (const value of Object.values(brand.colors)) {
      expect(root.style.cssText.toLowerCase()).toContain(value.toLowerCase());
    }
  });

  it('applies the configured brand fonts', () => {
    const root = document.createElement('div');
    applyBrandTheme(root);

    const display = root.style.getPropertyValue('--font-display');
    const body = root.style.getPropertyValue('--font-body');
    // Both fonts are set in branding.config.ts; the empty-string system-stack
    // fallback in applyBrandTheme remains for white-label configs without them.
    expect(display).toBe(brand.fonts.display);
    expect(body).toBe(brand.fonts.body);
    expect(display.trim().length).toBeGreaterThan(0);
    expect(body.trim().length).toBeGreaterThan(0);
  });

  it('defaults to the document root element', () => {
    applyBrandTheme();
    expect(document.documentElement.style.getPropertyValue('--color-primary')).toBe(
      brand.colors.primary,
    );
  });
});
