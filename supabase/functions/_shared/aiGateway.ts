/**
 * The governed AI gateway (OD-18) — the LOCKED GATE every AI layer goes
 * through. This module is the only code in the system that touches the
 * Anthropic API, and it enforces the guardrails in code, where prompts can't
 * talk them away (CLAUDE.md §1):
 *
 *   * model pinned (Haiku — Maria's choice, 2026-07-17), max_tokens capped,
 *     system prompt locked in server config (Spec §10) — user input never
 *     reaches the prompt;
 *   * human-approved ai_rules are appended as additional ABSOLUTE
 *     RESTRICTIONS (the OD-18 corrective loop's teeth);
 *   * output validated server-side: exactly 7 messages, ≤280 chars each,
 *     scripture references checked against the 66-book canon (catches
 *     invented books; the text of a quote is beyond static checking — the
 *     human reviewer is the second gate, and NOTHING ships without her);
 *   * zero student data in any prompt (§17.4 — the weekly batch needs none);
 *   * generation is rate-capped (cost control) and fails closed.
 *
 * Local/CI run with AI_TRANSPORT=canned (deterministic output, no network) —
 * same pattern as EMAIL_TRANSPORT=log. Production uses ANTHROPIC_API_KEY.
 */
import { serverLog } from './logger.ts';
import { brandName } from './magicLinks.ts';

// Raw HTTP by deliberate exception: the npm Anthropic SDK's bundle blows the
// Edge Function isolate's CPU soft limit at boot (observed killing the local
// edge runtime outright). The gateway makes exactly one plain JSON POST, so
// fetch — the same pattern as the Resend and Turnstile boundaries — is the
// correct transport here.
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// Pinned. Changing the model is a reviewed code change, never a request knob.
export const AI_MODEL = 'claude-haiku-4-5';
export const PROMPT_VERSION = 'encouragement-v1';
const MAX_TOKENS = 1500; // 7 short messages; hard cost ceiling
const TEMPERATURE = 1.0;

export const MESSAGE_MAX_CHARS = 280;
export const MESSAGES_PER_WEEK = 7;

/** Locked system prompt — Spec §10, verbatim intent. Not request-editable. */
function lockedSystemPrompt(rules: readonly string[]): string {
  const base = `You are the encouragement writer for ${brandName()}, a mentoring program
for young women ages 11-19. Generate exactly 7 short encouragement
messages (2-3 sentences each).

TONE REQUIREMENTS:
- Scripture-based motivation that uplifts
- Warm humor - like a cool auntie, not a Sunday school teacher
- Confident and reassuring
- Directly affirm the reader ("You are...", "Your crown...")
- Faith-infused but welcoming to all backgrounds

ABSOLUTE RESTRICTIONS:
- NEVER sound prophetic, preachy, or fire-and-brimstone
- NEVER use dry, scary, or condescending language
- NEVER hallucinate scripture - only cite real verses with accurate text
- NEVER use language associated with white nationalist Christianity
- NEVER patronize or talk down to the reader
- Keep each message under 280 characters

Return as a JSON array of exactly 7 strings. No preamble. No markdown.`;
  if (rules.length === 0) {
    return base;
  }
  const extra = rules.map((rule) => `- ${rule}`).join('\n');
  return `${base}\n\nADDITIONAL ABSOLUTE RESTRICTIONS (from the program team):\n${extra}`;
}

/** The 66-book canon (plus common numbered spellings) for reference checks. */
const CANON_BOOKS = new Set(
  [
    'genesis', 'exodus', 'leviticus', 'numbers', 'deuteronomy', 'joshua', 'judges', 'ruth',
    '1 samuel', '2 samuel', '1 kings', '2 kings', '1 chronicles', '2 chronicles', 'ezra',
    'nehemiah', 'esther', 'job', 'psalm', 'psalms', 'proverbs', 'ecclesiastes',
    'song of solomon', 'song of songs', 'isaiah', 'jeremiah', 'lamentations', 'ezekiel',
    'daniel', 'hosea', 'joel', 'amos', 'obadiah', 'jonah', 'micah', 'nahum', 'habakkuk',
    'zephaniah', 'haggai', 'zechariah', 'malachi', 'matthew', 'mark', 'luke', 'john', 'acts',
    'romans', '1 corinthians', '2 corinthians', 'galatians', 'ephesians', 'philippians',
    'colossians', '1 thessalonians', '2 thessalonians', '1 timothy', '2 timothy', 'titus',
    'philemon', 'hebrews', 'james', '1 peter', '2 peter', '1 john', '2 john', '3 john',
    'jude', 'revelation',
  ].map((b) => b.toLowerCase()),
);

/** Finds "Book 1:2"-style references and flags books outside the canon. */
export function hasInventedScripture(text: string): boolean {
  const pattern = /((?:[1-3]\s)?[A-Z][a-z]+(?:\s(?:of\s)?[A-Z][a-z]+)?)\s\d{1,3}:\d{1,3}/g;
  for (const match of text.matchAll(pattern)) {
    const book = (match[1] ?? '').toLowerCase();
    if (!CANON_BOOKS.has(book)) {
      return true;
    }
  }
  return false;
}

export type ValidationFailure =
  | 'not_an_array'
  | 'wrong_count'
  | 'empty_message'
  | 'too_long'
  | 'invented_scripture';

export type GatewayResult =
  | { ok: true; messages: string[]; metadata: Record<string, string | number> }
  | { ok: false; reason: 'not_configured' | 'api_error' | ValidationFailure };

/** Validates the raw model output against the Spec §10 contract. */
export function validateBatch(raw: unknown): { ok: true; messages: string[] } | { ok: false; reason: ValidationFailure } {
  if (!Array.isArray(raw)) {
    return { ok: false, reason: 'not_an_array' };
  }
  if (raw.length !== MESSAGES_PER_WEEK) {
    return { ok: false, reason: 'wrong_count' };
  }
  const messages: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string' || entry.trim() === '') {
      return { ok: false, reason: 'empty_message' };
    }
    const trimmed = entry.trim();
    if (trimmed.length > MESSAGE_MAX_CHARS) {
      return { ok: false, reason: 'too_long' };
    }
    if (hasInventedScripture(trimmed)) {
      return { ok: false, reason: 'invented_scripture' };
    }
    messages.push(trimmed);
  }
  return { ok: true, messages };
}

export function aiConfigured(): boolean {
  if (Deno.env.get('AI_TRANSPORT') === 'canned') {
    return true;
  }
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  return key !== undefined && key.trim() !== '';
}

/** Deterministic local/CI batch — passes the same validator as live output. */
const CANNED_BATCH = [
  'Good morning, queen. Psalm 139:14 says you are fearfully and wonderfully made — and that was written about YOU, crown and all. Walk like you know it today.',
  'Your crown does not slip when you ask for help. Even queens have counselors — Proverbs 15:22. Reach out today; that is strength, not weakness.',
  'Somebody needed your smile today and you gave it anyway. That is Philippians 2:4 energy, and heaven noticed even if the hallway did not.',
  "Hard day? Crowns get heavy sometimes. Isaiah 40:31 says wings are coming — until then it's okay to just walk. Even slow walking counts.",
  'You are not behind, you are becoming. Ecclesiastes 3:11 — everything beautiful in its time. Your time is coming, and honestly? It looks good on you.',
  'That thing you keep praying about? Keep going. Luke 18:1 says pray and do not give up — and giving up has never once matched your outfit.',
  'Rest is royal too. Even God rested on the seventh day — Genesis 2:2. Take the nap, drink the water, and let your soul catch up with your crown.',
];

/**
 * Generates the weekly batch through the locked gate. Never returns unvalidated
 * output; never throws. The caller stores drafts — publishing stays human.
 */
export async function generateEncouragementBatch(
  rules: readonly string[],
): Promise<GatewayResult> {
  if (Deno.env.get('AI_TRANSPORT') === 'canned') {
    const validated = validateBatch(CANNED_BATCH);
    if (!validated.ok) {
      return { ok: false, reason: validated.reason };
    }
    return {
      ok: true,
      messages: validated.messages,
      metadata: { model: 'canned', promptVersion: PROMPT_VERSION, inputTokens: 0, outputTokens: 0 },
    };
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (apiKey === undefined || apiKey.trim() === '') {
    return { ok: false, reason: 'not_configured' };
  }

  let text: string;
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system: lockedSystemPrompt(rules),
        messages: [
          {
            role: 'user',
            content:
              "Write this week's 7 daily encouragement messages, Monday through Sunday, as a JSON array of 7 strings.",
          },
        ],
      }),
    });
    if (!response.ok) {
      serverLog.error('ai_gateway.api_error', { httpStatus: response.status });
      return { ok: false, reason: 'api_error' };
    }
    const body = (await response.json()) as {
      content?: { type?: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
      stop_reason?: string;
    };
    const first = body.content?.[0];
    if (first === undefined || first.type !== 'text' || typeof first.text !== 'string') {
      serverLog.error('ai_gateway.no_text_block', { stopReason: body.stop_reason ?? 'unknown' });
      return { ok: false, reason: 'api_error' };
    }
    text = first.text;
    inputTokens = body.usage?.input_tokens ?? 0;
    outputTokens = body.usage?.output_tokens ?? 0;
  } catch {
    serverLog.error('ai_gateway.api_network_failed', {});
    return { ok: false, reason: 'api_error' };
  }

  // Models sometimes wrap JSON in fences despite instructions — unwrap only.
  const unfenced = text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch {
    serverLog.error('ai_gateway.unparseable_output', {});
    return { ok: false, reason: 'not_an_array' };
  }

  const validated = validateBatch(parsed);
  if (!validated.ok) {
    serverLog.error('ai_gateway.validation_failed', { failure: validated.reason });
    return { ok: false, reason: validated.reason };
  }

  return {
    ok: true,
    messages: validated.messages,
    metadata: { model: AI_MODEL, promptVersion: PROMPT_VERSION, inputTokens, outputTokens },
  };
}
