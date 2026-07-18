/**
 * The Relax room's working parts (Phase 11, Spec §6.3): breathing patterns
 * with a pure phase clock, the 5-4-3-2-1 grounding walk, and the
 * admin-curated calming library read (anon Data API — active rows only by
 * RLS; the service worker may cache exactly this response for offline).
 */
import type { ApiResult } from '@/lib/api';
import { readDataApi } from '@/lib/dataApi';

export type BreathStep = {
  phase: 'Breathe in' | 'Hold' | 'Breathe out';
  seconds: number;
};

export type BreathPattern = {
  id: string;
  name: string;
  hint: string;
  steps: readonly BreathStep[];
};

export const BREATH_PATTERNS: readonly BreathPattern[] = [
  {
    id: 'box',
    name: 'Box breathing',
    hint: 'Even and steady — four counts each side.',
    steps: [
      { phase: 'Breathe in', seconds: 4 },
      { phase: 'Hold', seconds: 4 },
      { phase: 'Breathe out', seconds: 4 },
      { phase: 'Hold', seconds: 4 },
    ],
  },
  {
    id: 'calm',
    name: '4·7·8 calm',
    hint: 'A longer exhale tells your body it’s safe to rest.',
    steps: [
      { phase: 'Breathe in', seconds: 4 },
      { phase: 'Hold', seconds: 7 },
      { phase: 'Breathe out', seconds: 8 },
    ],
  },
];

export type BreathMoment = {
  label: BreathStep['phase'];
  /** Whole seconds remaining in this step (counts down to 1). */
  secondsLeft: number;
  /**
   * The circle's posture: a hold keeps whatever the previous step reached —
   * full after an inhale, empty after an exhale.
   */
  shape: 'expand' | 'contract' | 'hold-full' | 'hold-empty';
  /** Duration of the current step, for the circle's transition timing. */
  stepSeconds: number;
};

function shapeFor(pattern: BreathPattern, index: number): BreathMoment['shape'] {
  const step = pattern.steps[index];
  if (step === undefined || step.phase === 'Breathe in') {
    return 'expand';
  }
  if (step.phase === 'Breathe out') {
    return 'contract';
  }
  const previous = pattern.steps[(index + pattern.steps.length - 1) % pattern.steps.length];
  return previous?.phase === 'Breathe out' ? 'hold-empty' : 'hold-full';
}

/** Where in the endless breathing loop `elapsedMs` lands. Pure — testable. */
export function breathMomentAt(pattern: BreathPattern, elapsedMs: number): BreathMoment {
  const cycleMs = pattern.steps.reduce((sum, step) => sum + step.seconds * 1000, 0);
  let within = ((elapsedMs % cycleMs) + cycleMs) % cycleMs;
  for (const [index, step] of pattern.steps.entries()) {
    const stepMs = step.seconds * 1000;
    if (within < stepMs) {
      return {
        label: step.phase,
        secondsLeft: Math.max(1, Math.ceil((stepMs - within) / 1000)),
        shape: shapeFor(pattern, index),
        stepSeconds: step.seconds,
      };
    }
    within -= stepMs;
  }
  // Unreachable: the modulo keeps `within` inside the cycle. Satisfies the
  // compiler without lying about a possible undefined.
  const first = pattern.steps[0];
  return {
    label: first?.phase ?? 'Breathe in',
    secondsLeft: first?.seconds ?? 4,
    shape: 'expand',
    stepSeconds: first?.seconds ?? 4,
  };
}

/** The 5-4-3-2-1 senses walk — gentle grounding, no clinical language. */
export const GROUNDING_STEPS: readonly { count: number; prompt: string }[] = [
  { count: 5, prompt: 'Name five things you can see around you.' },
  { count: 4, prompt: 'Find four things you can touch — notice how they feel.' },
  { count: 3, prompt: 'Listen for three sounds, near or far.' },
  { count: 2, prompt: 'Notice two things you can smell.' },
  { count: 1, prompt: 'Take one slow breath and thank God you’re here.' },
];

export type RelaxKind = 'affirmation' | 'scripture' | 'grounding';

export type RelaxItem = {
  id: string;
  kind: RelaxKind;
  title: string;
  body: string;
};

export const KIND_HEADINGS: Readonly<Record<RelaxKind, string>> = {
  affirmation: 'Words to hold onto',
  scripture: 'Scripture for still moments',
  grounding: 'More ways to ground yourself',
};

function parseItem(raw: unknown): RelaxItem {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('relaxation item is not an object');
  }
  const r = raw as Record<string, unknown>;
  if (
    typeof r.id !== 'string' ||
    (r.kind !== 'affirmation' && r.kind !== 'scripture' && r.kind !== 'grounding') ||
    typeof r.title !== 'string' ||
    typeof r.body !== 'string'
  ) {
    throw new Error('relaxation item is malformed');
  }
  return { id: r.id, kind: r.kind, title: r.title, body: r.body };
}

/** Active library items, curated order. RLS already hides retired rows. */
export async function fetchRelaxLibrary(): Promise<ApiResult<RelaxItem[]>> {
  const query = 'select=id,kind,title,body&order=kind.asc&order=sort_order.asc&limit=100';
  return readDataApi(`relaxation_content?${query}`, {
    parse: (raw) => {
      if (!Array.isArray(raw)) {
        throw new Error('relaxation response is not an array');
      }
      return raw.map(parseItem);
    },
  });
}
