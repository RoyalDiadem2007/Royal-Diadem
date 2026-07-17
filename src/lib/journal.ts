/**
 * Client for the journal Edge Function (Phase 6, Spec §6.4). Entries travel
 * decrypted over TLS to their author only; nothing here is ever cached or
 * stored client-side (CLAUDE.md §3). Flag state never reaches this wire.
 */
import { callEdgeFunction, type ApiResult } from '@/lib/api';

export type JournalPrompt = { id: string; text: string };

export type JournalEntry = {
  id: string;
  promptText: string | null;
  text: string;
  createdAt: string;
};

export type JournalHome = { prompts: JournalPrompt[]; entries: JournalEntry[] };

function asRecord(raw: unknown, what: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${what} is not an object`);
  }
  return raw as Record<string, unknown>;
}

function parseHome(raw: unknown): JournalHome {
  const record = asRecord(raw, 'journal response');
  if (!Array.isArray(record.prompts) || !Array.isArray(record.entries)) {
    throw new Error('journal response is malformed');
  }
  return {
    prompts: record.prompts.map((p) => {
      const r = asRecord(p, 'prompt');
      if (typeof r.id !== 'string' || typeof r.text !== 'string') {
        throw new Error('prompt is malformed');
      }
      return { id: r.id, text: r.text };
    }),
    entries: record.entries.map((e) => {
      const r = asRecord(e, 'entry');
      if (
        typeof r.id !== 'string' ||
        typeof r.text !== 'string' ||
        typeof r.createdAt !== 'string' ||
        (r.promptText !== null && typeof r.promptText !== 'string')
      ) {
        throw new Error('entry is malformed');
      }
      return { id: r.id, promptText: r.promptText, text: r.text, createdAt: r.createdAt };
    }),
  };
}

export async function fetchJournal(sessionToken: string): Promise<ApiResult<JournalHome>> {
  return callEdgeFunction('journal', { method: 'GET', sessionToken, parse: parseHome });
}

export async function writeJournalEntry(
  sessionToken: string,
  input: { promptId?: string; text: string },
): Promise<ApiResult<{ id: string }>> {
  return callEdgeFunction('journal', {
    method: 'POST',
    sessionToken,
    body: input,
    parse: (raw) => {
      const record = asRecord(raw, 'write response');
      const entry = asRecord(record.entry, 'entry');
      if (typeof entry.id !== 'string') {
        throw new Error('write response is malformed');
      }
      return { id: entry.id };
    },
  });
}
