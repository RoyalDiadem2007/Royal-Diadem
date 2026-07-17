/**
 * Journal concerning-language detection (Spec §6.4/§7): PATTERN MATCHING
 * ONLY — no model call, no interpretation. A match raises a high-severity
 * flag (OD-3: immediate super_admin visibility) carrying the CATEGORY, never
 * the matched words — flag reasons are metadata, journal text stays encrypted.
 *
 * This list is a deliberate floor, tuned for recall on unambiguous phrases.
 * Expanding/tuning it belongs with the OD-3 human protocol conversation
 * (Kenecia/clinical input), not to quiet iteration.
 */

export const JOURNAL_FLAG_SEVERITY = 'high';

type PatternGroup = { category: string; patterns: readonly RegExp[] };

const PATTERN_GROUPS: readonly PatternGroup[] = [
  {
    category: 'self-harm language',
    patterns: [
      /kill\s+myself/i,
      /want(?:\s+to)?\s+die/i,
      /suicid/i,
      /hurt(?:ing)?\s+myself/i,
      /self[\s-]?harm/i,
      /cut(?:ting)?\s+myself/i,
      /end\s+my\s+life/i,
      /end\s+it\s+all/i,
      /better\s+off\s+dead/i,
      /no\s+reason\s+to\s+live/i,
    ],
  },
  {
    category: 'possible abuse',
    patterns: [
      /\bhits?\s+me\b/i,
      /\bhurts?\s+me\b/i,
      /touch(?:es|ed|ing)?\s+me\b/i,
      /afraid\s+(?:of\s+(?:him|her|them)|to\s+go\s+home)/i,
      /scared\s+to\s+go\s+home/i,
      /threatens?\s+me/i,
    ],
  },
  {
    category: 'crisis signals',
    patterns: [
      /run(?:ning)?\s+away\s+from\s+home/i,
      /starv(?:e|ing)\s+myself/i,
      /haven'?t\s+eaten\s+in/i,
      /nowhere\s+to\s+sleep/i,
    ],
  },
];

export type FlagScan = { flagged: false } | { flagged: true; category: string };

export function scanJournalText(text: string): FlagScan {
  for (const group of PATTERN_GROUPS) {
    if (group.patterns.some((pattern) => pattern.test(text))) {
      return { flagged: true, category: group.category };
    }
  }
  return { flagged: false };
}

/** Reason stored on the entry/flag — category only, never contents. */
export function flagReason(category: string): string {
  return `journal pattern match: ${category}`;
}
