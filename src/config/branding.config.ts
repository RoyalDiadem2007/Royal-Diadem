/**
 * branding.config.ts — SINGLE SOURCE OF TRUTH for all visual identity (Spec §4).
 *
 * White-label is non-negotiable (Spec §3): zero hardcoded colors, org names, logos,
 * or messaging anywhere else in the codebase. Every component, the HTML shell, and
 * the PWA manifest read from this file. To rebrand the platform for another
 * organization, change this file only.
 */

export type BrandColors = {
  primary: string;
  secondary: string;
  accent: string;
  surfaceLight: string;
  background: string;
  crownGold: string;
  textPrimary: string;
  textSecondary: string;
  cardSurface: string;
  success: string;
  warning: string;
  danger: string;
};

export type BrandFonts = {
  /** Elegant script for headings (matching logo script). Empty = system fallback. */
  display: string;
  /** Clean, readable body text. Empty = system fallback. */
  body: string;
};

export type BrandConfig = {
  name: string;
  /** Awaiting client copy — empty string until provided (Spec §12). */
  tagline: string;
  /** Used for the PWA manifest description and the HTML meta description. */
  appDescription: string;
  colors: BrandColors;
  logo: string;
  fonts: BrandFonts;
  /** Crown/queen themed emoji set for Share page reactions (Spec §6.8). */
  reactions: readonly string[];
};

export const brand: BrandConfig = {
  name: 'Royal Diadem',
  tagline: '',
  appDescription: 'Empowerment platform for young queens',
  colors: {
    primary: '#E05070', // Royal pink (flamingo body, "Royal" text)
    secondary: '#C01050', // Deep magenta ("Diadem" script)
    accent: '#F0C0B0', // Rose gold / warm blush (feathers, glow)
    surfaceLight: '#F0D0C0', // Soft peach (highlights)
    background: '#0A0A0A', // Rich black
    crownGold: '#F0B0A0', // Warm gold-pink (crown jewels, sparkles)
    textPrimary: '#FFFFFF',
    textSecondary: '#F0C0B0',
    cardSurface: '#1A1A1A',
    success: '#4CAF50',
    warning: '#FFB74D',
    danger: '#EF5350',
  },
  logo: '/assets/royal-diadem-logo.png', // Crowned flamingo
  fonts: {
    display: '',
    body: '',
  },
  reactions: ['👑', '💎', '🦩', '👏', '✨', '💪', '🌹', '🎉', '💖', '🔥'],
};
