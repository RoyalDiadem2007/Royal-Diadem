/**
 * Crown Check mood scale (Spec §6.2): visual/emoji-driven, not clinical.
 * THE DECIDED SET (Maria, 2026-07-18): the crown-sitting metaphor — 👑 down
 * to 🌧️ — with the question "How is your crown sitting today?". Swap
 * emojis/labels here only; scores 1–5 are the contract the server and trend
 * views rely on.
 */

export type MoodTier = {
  /** 1 (lowest) – 5 (highest). The number the flag rule and trends use. */
  score: 1 | 2 | 3 | 4 | 5;
  emoji: string;
  /** Warm, girl-facing word — never clinical. */
  label: string;
};

// Labels refined with the SXU mockup (Maria, 2026-07-19): warmer words over
// the same five decided symbols. The emoji stays the stored canonical symbol
// (data contract unchanged); the UI draws matching line icons. Kenecia gets
// final say on wording during her walkthrough — this is a config-only swap.
export const MOOD_SCALE: readonly MoodTier[] = [
  { score: 1, emoji: '🌧️', label: 'Stormy' },
  { score: 2, emoji: '💧', label: 'Low' },
  { score: 3, emoji: '🌹', label: 'Tender' },
  { score: 4, emoji: '✨', label: 'Steady' },
  { score: 5, emoji: '👑', label: 'Radiant' },
];

/** The card heading + daily question (Maria's wording, 2026-07-18). */
export const CHECK_TITLE = 'Today’s Crown Check';
export const CHECK_QUESTION = 'How is your crown sitting today?';

/** Spec §6.2 wording — the optional one-line note prompt. */
export const NOTE_PROMPT = "What's on your mind, queen?";
export const NOTE_MAX_LENGTH = 280;

export function moodTierFor(score: number): MoodTier | undefined {
  return MOOD_SCALE.find((tier) => tier.score === score);
}
