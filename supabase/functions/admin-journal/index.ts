/**
 * admin-journal — journal review + prompt management (Phase 6, Spec §6.10
 * "Journals": student entries, AI flag alerts).
 *   GET  /admin-journal                     roster: active students with entry
 *                                           counts + needs-review indicator
 *   GET  /admin-journal/student?studentId=  one student's entries, decrypted
 *                                           for the authorized reviewer
 *   GET  /admin-journal/prompts             all prompts
 *   POST /admin-journal/prompts             create a prompt
 *   POST /admin-journal/prompts/toggle      activate/retire a prompt
 *
 * super_admin only until the mentor-assignment model lands (OD-6) — the same
 * rule as Students/Crown Checks; mentors join with assignment scoping. Every
 * decrypted read is audit-logged against the student's id.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { z } from 'npm:zod@4';
import { createServiceClient } from '../_shared/db.ts';
import { errorResponse, handlePreflight, jsonResponse } from '../_shared/http.ts';
import { requireAdmin, type AdminContext } from '../_shared/adminAuth.ts';
import { writeAudit } from '../_shared/audit.ts';
import { serverLog } from '../_shared/logger.ts';
import { decryptJournalText, journalCryptoConfigured } from '../_shared/journalCrypto.ts';
import { createPromptSchema, parseJsonBody, togglePromptSchema } from '../_shared/validate.ts';

const ENTITY = 'journal';
const PAGE_SIZE = 50;
const DETAIL_LIMIT = 30;

async function studentsNeedingReview(db: SupabaseClient): Promise<Set<string> | null> {
  const { data: flags, error: flagError } = await db
    .from('flags')
    .select('entity_id')
    .eq('source', 'ai')
    .eq('entity_type', ENTITY)
    .neq('status', 'resolved');
  if (flagError !== null) {
    serverLog.error('admin_journal.flag_query_failed', {});
    return null;
  }
  const entryIds = flags.map((f) => String(f.entity_id));
  if (entryIds.length === 0) {
    return new Set();
  }
  const { data: entries, error } = await db
    .from('journal_entries')
    .select('student_id')
    .in('id', entryIds);
  if (error !== null) {
    serverLog.error('admin_journal.flag_owner_query_failed', {});
    return null;
  }
  return new Set(entries.map((e) => String(e.student_id)));
}

async function handleRoster(
  db: SupabaseClient,
  req: Request,
  ctx: AdminContext,
): Promise<Response> {
  const pageParam = new URL(req.url).searchParams.get('page') ?? '1';
  const page = /^\d{1,6}$/.test(pageParam) ? Math.max(1, Number(pageParam)) : 1;
  const from = (page - 1) * PAGE_SIZE;

  const { data: students, error, count } = await db
    .from('students')
    .select('id, display_name, first_name, last_name', { count: 'exact' })
    .eq('status', 'active')
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true })
    .range(from, from + PAGE_SIZE - 1);
  if (error !== null || count === null) {
    serverLog.error('admin_journal.roster_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  const ids = students.map((s) => String(s.id));
  const entryMeta = new Map<string, { count: number; lastAt: string }>();
  if (ids.length > 0) {
    const { data: entries, error: entriesError } = await db
      .from('journal_entries')
      .select('student_id, created_at')
      .in('student_id', ids)
      .order('created_at', { ascending: false });
    if (entriesError !== null) {
      serverLog.error('admin_journal.entry_meta_failed', {});
      return errorResponse(req, 500, 'server_error');
    }
    for (const row of entries as { student_id: string; created_at: string }[]) {
      const existing = entryMeta.get(row.student_id);
      if (existing === undefined) {
        entryMeta.set(row.student_id, { count: 1, lastAt: row.created_at });
      } else {
        existing.count += 1;
      }
    }
  }

  const needsReview = await studentsNeedingReview(db);
  if (needsReview === null) {
    return errorResponse(req, 500, 'server_error');
  }

  const roster = students.map((s) => {
    const id = String(s.id);
    const meta = entryMeta.get(id);
    return {
      studentId: id,
      displayName: String(s.display_name),
      firstName: String(s.first_name),
      lastName: String(s.last_name),
      entryCount: meta?.count ?? 0,
      lastEntryAt: meta?.lastAt ?? null,
      needsReview: needsReview.has(id),
    };
  });

  await writeAudit(db, {
    actorType: 'admin',
    actorId: ctx.subject.subjectId,
    actorRole: ctx.role,
    action: 'read',
    entityType: ENTITY,
    entityId: null,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { view: 'roster', page, returned: roster.length },
  });

  return jsonResponse(req, 200, { students: roster, page, pageSize: PAGE_SIZE, total: count });
}

const studentQuerySchema = z.object({ studentId: z.uuid() });

async function handleStudentDetail(
  db: SupabaseClient,
  req: Request,
  ctx: AdminContext,
): Promise<Response> {
  const parsed = studentQuerySchema.safeParse({
    studentId: new URL(req.url).searchParams.get('studentId'),
  });
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }
  const { studentId } = parsed.data;

  const { data: student, error: studentError } = await db
    .from('students')
    .select('id, display_name')
    .eq('id', studentId)
    .maybeSingle();
  if (studentError !== null) {
    serverLog.error('admin_journal.student_lookup_failed', {});
    return errorResponse(req, 500, 'server_error');
  }
  if (student === null) {
    return errorResponse(req, 404, 'not_found');
  }

  const { data: rows, error } = await db
    .from('journal_entries')
    .select('id, prompt_id, entry_ciphertext, entry_iv, ai_flag_triggered, ai_flag_reason, created_at')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
    .limit(DETAIL_LIMIT);
  if (error !== null) {
    serverLog.error('admin_journal.detail_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  const { data: prompts, error: promptsError } = await db
    .from('journal_prompts')
    .select('id, prompt_text');
  if (promptsError !== null) {
    serverLog.error('admin_journal.prompt_lookup_failed', {});
    return errorResponse(req, 500, 'server_error');
  }
  const promptText = new Map(prompts.map((p) => [String(p.id), String(p.prompt_text)]));

  const entries = [];
  for (const row of rows as {
    id: string;
    prompt_id: string | null;
    entry_ciphertext: string;
    entry_iv: string;
    ai_flag_triggered: boolean;
    ai_flag_reason: string | null;
    created_at: string;
  }[]) {
    const text = await decryptJournalText({ ciphertext: row.entry_ciphertext, iv: row.entry_iv });
    if (text === null) {
      return errorResponse(req, 500, 'server_error');
    }
    entries.push({
      id: row.id,
      promptText: row.prompt_id === null ? null : (promptText.get(row.prompt_id) ?? null),
      text,
      aiFlagTriggered: row.ai_flag_triggered,
      aiFlagReason: row.ai_flag_reason,
      createdAt: row.created_at,
    });
  }

  await writeAudit(db, {
    actorType: 'admin',
    actorId: ctx.subject.subjectId,
    actorRole: ctx.role,
    action: 'read',
    entityType: ENTITY,
    entityId: studentId,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { view: 'student', returned: entries.length },
  });

  return jsonResponse(req, 200, {
    student: { studentId: String(student.id), displayName: String(student.display_name) },
    entries,
  });
}

async function handlePromptList(
  db: SupabaseClient,
  req: Request,
  ctx: AdminContext,
): Promise<Response> {
  const { data, error } = await db
    .from('journal_prompts')
    .select('id, prompt_text, active, created_at')
    .order('created_at', { ascending: false });
  if (error !== null) {
    serverLog.error('admin_journal.prompt_list_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  await writeAudit(db, {
    actorType: 'admin',
    actorId: ctx.subject.subjectId,
    actorRole: ctx.role,
    action: 'read',
    entityType: 'journal_prompt',
    entityId: null,
    outcome: 'allowed',
    ip: ctx.ip,
  });

  return jsonResponse(req, 200, {
    prompts: data.map((row) => ({
      id: String(row.id),
      text: String(row.prompt_text),
      active: row.active === true,
    })),
  });
}

async function handlePromptCreate(
  db: SupabaseClient,
  req: Request,
  ctx: AdminContext,
): Promise<Response> {
  const parsed = createPromptSchema.safeParse(await parseJsonBody(req));
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }
  const { data, error } = await db
    .from('journal_prompts')
    .insert({ prompt_text: parsed.data.text, created_by: ctx.subject.subjectId })
    .select('id')
    .maybeSingle();
  if (error !== null || data === null) {
    serverLog.error('admin_journal.prompt_create_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  await writeAudit(db, {
    actorType: 'admin',
    actorId: ctx.subject.subjectId,
    actorRole: ctx.role,
    action: 'create',
    entityType: 'journal_prompt',
    entityId: String(data.id),
    outcome: 'allowed',
    ip: ctx.ip,
  });

  return jsonResponse(req, 201, { prompt: { id: String(data.id) } });
}

async function handlePromptToggle(
  db: SupabaseClient,
  req: Request,
  ctx: AdminContext,
): Promise<Response> {
  const parsed = togglePromptSchema.safeParse(await parseJsonBody(req));
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }
  const { promptId, active } = parsed.data;
  const { data, error } = await db
    .from('journal_prompts')
    .update({ active })
    .eq('id', promptId)
    .select('id')
    .maybeSingle();
  if (error !== null) {
    serverLog.error('admin_journal.prompt_toggle_failed', {});
    return errorResponse(req, 500, 'server_error');
  }
  if (data === null) {
    return errorResponse(req, 404, 'not_found');
  }

  await writeAudit(db, {
    actorType: 'admin',
    actorId: ctx.subject.subjectId,
    actorRole: ctx.role,
    action: 'update',
    entityType: 'journal_prompt',
    entityId: promptId,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { active },
  });

  return jsonResponse(req, 200, { prompt: { id: promptId, active } });
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight !== null) {
    return preflight;
  }

  const segments = new URL(req.url).pathname.split('/').filter((s) => s !== '');
  const action = segments.at(-1);
  const parent = segments.at(-2);

  const db = createServiceClient();
  if (!(await journalCryptoConfigured())) {
    return errorResponse(req, 503, 'journal_not_configured');
  }
  const auth = await requireAdmin(db, req, ENTITY, ['super_admin']);
  if (!auth.ok) {
    return auth.response;
  }

  if (action === 'admin-journal' && req.method === 'GET') {
    return handleRoster(db, req, auth.ctx);
  }
  if (action === 'student' && req.method === 'GET') {
    return handleStudentDetail(db, req, auth.ctx);
  }
  if (action === 'prompts' && req.method === 'GET') {
    return handlePromptList(db, req, auth.ctx);
  }
  if (action === 'prompts' && req.method === 'POST') {
    return handlePromptCreate(db, req, auth.ctx);
  }
  if (action === 'toggle' && parent === 'prompts' && req.method === 'POST') {
    return handlePromptToggle(db, req, auth.ctx);
  }
  return errorResponse(req, 405, 'method_not_allowed');
});
