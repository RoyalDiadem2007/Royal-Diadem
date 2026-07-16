import { describe, expect, it } from 'vitest';
import { brand } from '@/config/branding.config';

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

describe('branding config contract', () => {
  it('has a non-empty organization name', () => {
    expect(brand.name.trim().length).toBeGreaterThan(0);
  });

  it('defines every color as a 6-digit hex value', () => {
    for (const [key, value] of Object.entries(brand.colors)) {
      expect(value, `colors.${key}`).toMatch(HEX_COLOR);
    }
  });

  it('points the logo at an absolute public path', () => {
    expect(brand.logo.startsWith('/')).toBe(true);
    expect(brand.logo.trim().length).toBeGreaterThan(1);
  });

  it('provides a non-empty, duplicate-free reaction set', () => {
    expect(brand.reactions.length).toBeGreaterThan(0);
    expect(new Set(brand.reactions).size).toBe(brand.reactions.length);
    for (const reaction of brand.reactions) {
      expect(reaction.trim().length).toBeGreaterThan(0);
    }
  });

  it('has an app description for the PWA manifest', () => {
    expect(brand.appDescription.trim().length).toBeGreaterThan(0);
  });
});
