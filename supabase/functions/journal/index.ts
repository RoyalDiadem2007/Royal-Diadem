/**
 * journal — student journal exercise (Phase 6, Spec §6.4).
 *   GET  /journal   active prompts + her own recent entries (decrypted for
 *                   the author, over TLS only)
 *   POST /journal   write an entry: concerning-language scan (pattern only,
 *                   Spec §7) → AES-256-GCM encrypt (OD-2) → insert. A match
 *                   raises ONE high-severity flag for this entry.
 *
 * Transparency model (Spec §6.4): her mentor can read entries and she knows
 * it — the client says so where she writes. Flag state is never returned to
 * the student. Fails closed (503) if the encryption key is unconfigured —
 * plaintext at rest is not a fallback.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { createServiceClient } from '../_shared/db.ts';
import { errorResponse, handlePreflight, jsonResponse } from '../_shared/http.ts';
import { requireStudent, type StudentContext } from '../_shared/studentAuth.ts';
import { writeAudit } from '../_shared/audit.ts';
import { serverLog } from '../_shared/logger.ts';
import {
  decryptJournalText,
  encryptJournalText,
  journalCryptoConfigured,
} from '../_shared/journalCrypto.ts';
import { flagReason, JOURNAL_FLAG_SEVERITY, scanJournalText } from '../_shared/journalFlag.ts';
import { parseJsonBody, writeJournalSchema } from '../_shared/validate.ts';

const ENTITY = 'journal';
const RECENT_ENTRIES = 20;

type EntryRow = {
  id: string;
  prompt_id: string | null;
  entry_ciphertext: string;
  entry_iv: string;
  created_at: string;
};

async function activePrompts(
  db: SupabaseClient,
): Promise<{ id: string; text: string }[] | null> {
  const { data, error } = await db
    .from('journal_prompts')
    .select('id, prompt_text')
    .eq('active', true)
    .order('created_at', { ascending: false });
  if (error !== null) {
    serverLog.error('journal.prompts_failed', {});
    return null;
  }
  return data.map((row) => ({ id: String(row.id), text: String(row.prompt_text) }));
}

async function handleGet(db: SupabaseClient, req: Request, ctx: StudentContext): Promise<Response> {
  const prompts = await activePrompts(db);
  if (prompts === null) {
    return errorResponse(req, 500, 'server_error');
  }

  const { data, error } = await db
    .from('journal_entries')
    .select('id, prompt_id, entry_ciphertext, entry_iv, created_at')
    .eq('student_id', ctx.subject.subjectId)
    .order('created_at', { ascending: false })
    .limit(RECENT_ENTRIES);
  if (error !== null) {
    serverLog.error('journal.list_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  const promptText = new Map(prompts.map((p) => [p.id, p.text]));
  const entries = [];
  for (const row of data as EntryRow[]) {
    const text = await decryptJournalText({ ciphertext: row.entry_ciphertext, iv: row.entry_iv });
    if (text === null) {
      // A row we cannot decrypt is an operational incident, not a silent gap.
      return errorResponse(req, 500, 'server_error');
    }
    entries.push({
      id: row.id,
      promptText: row.prompt_id === null ? null : (promptText.get(row.prompt_id) ?? null),
      text,
      createdAt: row.created_at,
    });
  }

  await writeAudit(db, {
    actorType: 'student',
    actorId: ctx.subject.subjectId,
    actorRole: 'student',
    action: 'read',
    entityType: ENTITY,
    entityId: null,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { returned: entries.length },
  });

  return jsonResponse(req, 200, { prompts, entries });
}

async function handleWrite(
  db: SupabaseClient,
  req: Request,
  ctx: StudentContext,
): Promise<Response> {
  const parsed = writeJournalSchema.safeParse(await parseJsonBody(req, 30_000));
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }
  const { promptId, text } = parsed.data;

  const scan = scanJournalText(text);
  const encrypted = await encryptJournalText(text);
  if (encrypted === null) {
    return errorResponse(req, 503, 'journal_not_configured');
  }

  const { data: inserted, error } = await db
    .from('journal_entries')
    .insert({
      student_id: ctx.subject.subjectId,
      prompt_id: promptId ?? null,
      entry_ciphertext: encrypted.ciphertext,
      entry_iv: encrypted.iv,
      ai_flag_triggered: scan.flagged,
      ai_flag_reason: scan.flagged ? flagReason(scan.category) : null,
    })
    .select('id, created_at')
    .maybeSingle();
  if (error !== null || inserted === null) {
    serverLog.error('journal.insert_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  let flagged = false;
  if (scan.flagged) {
    const { error: flagError } = await db.from('flags').insert({
      source: 'ai',
      entity_type: ENTITY,
      entity_id: String(inserted.id),
      severity: JOURNAL_FLAG_SEVERITY,
    });
    if (flagError !== null) {
      // Loud but non-fatal: her entry is saved; the row itself still carries
      // ai_flag_triggered for the admin view.
      serverLog.error('journal.flag_insert_failed', {});
    } else {
      flagged = true;
    }
  }

  await writeAudit(db, {
    actorType: 'student',
    actorId: ctx.subject.subjectId,
    actorRole: 'student',
    action: 'create',
    entityType: ENTITY,
    entityId: String(inserted.id),
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { flagRaised: flagged },
  });

  return jsonResponse(req, 201, {
    entry: { id: String(inserted.id), createdAt: String(inserted.created_at) },
  });
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight !== null) {
    return preflight;
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return errorResponse(req, 405, 'method_not_allowed');
  }

  const db = createServiceClient();
  if (!(await journalCryptoConfigured())) {
    return errorResponse(req, 503, 'journal_not_configured');
  }
  const auth = await requireStudent(db, req, ENTITY);
  if (!auth.ok) {
    return auth.response;
  }

  return req.method === 'GET' ? handleGet(db, req, auth.ctx) : handleWrite(db, req, auth.ctx);
});
