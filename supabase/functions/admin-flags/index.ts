/**
 * admin-flags — the Flag Center (Phase 14, Spec §7 / §6.10 "Flags"): every
 * AI and peer flag in one place with status tracking. The most sensitive
 * admin surface after journals: super_admin only until OD-6/OD-12. Context
 * lines carry ids, names, dates and reason CATEGORIES — never journal text
 * or note contents (CLAUDE.md §6). Flags are permanent: they move through
 * new → reviewed → resolved and are never deleted. Escalation beyond this
 * panel (email/SMS, mandated reporting) is the pending OD-3 human protocol.
 *
 *   GET  /admin-flags?page=&scope=open|all
 *   POST /admin-flags/update   { flagId, status: 'reviewed'|'resolved', note? }
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { z } from 'npm:zod@4';
import { createServiceClient } from '../_shared/db.ts';
import { errorResponse, handlePreflight, jsonResponse } from '../_shared/http.ts';
import { requireAdmin, type AdminContext } from '../_shared/adminAuth.ts';
import { writeAudit } from '../_shared/audit.ts';
import { serverLog } from '../_shared/logger.ts';

const ENTITY = 'flag';
const PAGE_SIZE = 50;

const updateSchema = z
  .object({
    flagId: z.uuid(),
    status: z.enum(['reviewed', 'resolved']),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();

type FlagRow = {
  id: string;
  source: string;
  entity_type: string;
  entity_id: string;
  flagged_by: string | null;
  severity: string;
  status: string;
  admin_notes: string | null;
  created_at: string;
  resolved_at: string | null;
};

type Context = { studentId: string | null; studentName: string | null; detail: string | null };

async function nameMap(
  db: SupabaseClient,
  studentIds: readonly string[],
): Promise<Map<string, string> | null> {
  if (studentIds.length === 0) {
    return new Map();
  }
  const { data, error } = await db
    .from('students')
    .select('id, display_name')
    .in('id', [...new Set(studentIds)]);
  if (error !== null) {
    serverLog.error('admin_flags.names_failed', {});
    return null;
  }
  return new Map(data.map((s) => [String(s.id), String(s.display_name)]));
}

/**
 * Resolves each flag's human context — whose content, and the safe detail
 * line (reason category / date) — with one batched query per entity table.
 */
async function contextFor(
  db: SupabaseClient,
  flags: readonly FlagRow[],
): Promise<Map<string, Context> | null> {
  const byType = (type: string) =>
    flags.filter((f) => f.entity_type === type).map((f) => f.entity_id);
  const contexts = new Map<string, Context>();
  const studentIdOf = new Map<string, string>();

  const checkIds = byType('crown_check');
  if (checkIds.length > 0) {
    const { data, error } = await db
      .from('crown_checks')
      .select('id, student_id, check_date, ai_flag_reason')
      .in('id', checkIds);
    if (error !== null) {
      serverLog.error('admin_flags.crown_context_failed', {});
      return null;
    }
    for (const row of data) {
      studentIdOf.set(String(row.id), String(row.student_id));
      contexts.set(String(row.id), {
        studentId: String(row.student_id),
        studentName: null,
        detail: `Crown Check ${String(row.check_date)}${row.ai_flag_reason === null ? '' : ` — ${String(row.ai_flag_reason)}`}`,
      });
    }
  }

  const journalIds = byType('journal');
  if (journalIds.length > 0) {
    const { data, error } = await db
      .from('journal_entries')
      .select('id, student_id, created_at, ai_flag_reason')
      .in('id', journalIds);
    if (error !== null) {
      serverLog.error('admin_flags.journal_context_failed', {});
      return null;
    }
    for (const row of data) {
      studentIdOf.set(String(row.id), String(row.student_id));
      contexts.set(String(row.id), {
        studentId: String(row.student_id),
        studentName: null,
        detail: `Journal entry ${String(row.created_at).slice(0, 10)}${row.ai_flag_reason === null ? '' : ` — ${String(row.ai_flag_reason)}`}`,
      });
    }
  }

  const postIds = byType('share_post');
  if (postIds.length > 0) {
    const { data, error } = await db
      .from('share_posts')
      .select('id, student_id, created_at, moderation_status')
      .in('id', postIds);
    if (error !== null) {
      serverLog.error('admin_flags.post_context_failed', {});
      return null;
    }
    for (const row of data) {
      studentIdOf.set(String(row.id), String(row.student_id));
      contexts.set(String(row.id), {
        studentId: String(row.student_id),
        studentName: null,
        detail: `Share post ${String(row.created_at).slice(0, 10)} — now ${String(row.moderation_status)}`,
      });
    }
  }

  const commentIds = byType('share_comment');
  if (commentIds.length > 0) {
    const { data, error } = await db
      .from('share_comments')
      .select('id, student_id, created_at, moderation_status')
      .in('id', commentIds);
    if (error !== null) {
      serverLog.error('admin_flags.comment_context_failed', {});
      return null;
    }
    for (const row of data) {
      studentIdOf.set(String(row.id), String(row.student_id));
      contexts.set(String(row.id), {
        studentId: String(row.student_id),
        studentName: null,
        detail: `Share comment ${String(row.created_at).slice(0, 10)} — now ${String(row.moderation_status)}`,
      });
    }
  }

  // One name lookup covers content authors AND peer flaggers.
  const flaggerIds = flags
    .map((f) => f.flagged_by)
    .filter((id): id is string => id !== null);
  const names = await nameMap(db, [...studentIdOf.values(), ...flaggerIds]);
  if (names === null) {
    return null;
  }
  for (const [entityId, context] of contexts) {
    const studentId = studentIdOf.get(entityId);
    context.studentName =
      studentId === undefined ? null : (names.get(studentId) ?? null);
  }
  // Stash flagger names under the flag id namespace to avoid a second map.
  for (const flag of flags) {
    if (flag.flagged_by !== null) {
      contexts.set(`flagger:${flag.id}`, {
        studentId: null,
        studentName: names.get(flag.flagged_by) ?? null,
        detail: null,
      });
    }
  }
  return contexts;
}

async function handleList(db: SupabaseClient, req: Request, ctx: AdminContext): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const pageParam = params.get('page') ?? '1';
  const page = /^\d{1,6}$/.test(pageParam) ? Math.max(1, Number(pageParam)) : 1;
  const scope = params.get('scope') === 'all' ? 'all' : 'open';
  const from = (page - 1) * PAGE_SIZE;

  let query = db
    .from('flags')
    .select('id, source, entity_type, entity_id, flagged_by, severity, status, admin_notes, created_at, resolved_at', {
      count: 'exact',
    });
  if (scope === 'open') {
    query = query.neq('status', 'resolved');
  }
  // 'new' sorts before 'reviewed'/'resolved' alphabetically; severity is NOT
  // sortable as text ('high' < 'medium'), so it renders as a chip instead.
  const { data, error, count } = await query
    .order('status', { ascending: true })
    .order('created_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (error !== null || count === null) {
    serverLog.error('admin_flags.list_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  const flagRows = data as FlagRow[];
  const contexts = await contextFor(db, flagRows);
  if (contexts === null) {
    return errorResponse(req, 500, 'server_error');
  }

  await writeAudit(db, {
    actorType: 'admin',
    actorId: ctx.subject.subjectId,
    actorRole: ctx.role,
    action: 'read',
    entityType: ENTITY,
    entityId: null,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { view: 'flag_center', scope, page, returned: flagRows.length },
  });

  return jsonResponse(req, 200, {
    flags: flagRows.map((flag) => ({
      id: flag.id,
      source: flag.source === 'peer' ? 'peer' : 'ai',
      entityType: flag.entity_type,
      severity: flag.severity,
      status: flag.status,
      createdAt: flag.created_at,
      resolvedAt: flag.resolved_at,
      adminNotes: flag.admin_notes,
      // Content owner's id — lets the client deep-link into her section
      // (an id, never contents, per the header contract).
      studentId: contexts.get(flag.entity_id)?.studentId ?? null,
      studentName: contexts.get(flag.entity_id)?.studentName ?? null,
      detail: contexts.get(flag.entity_id)?.detail ?? null,
      flaggedBy: contexts.get(`flagger:${flag.id}`)?.studentName ?? null,
    })),
    scope,
    page,
    pageSize: PAGE_SIZE,
    total: count,
  });
}

async function handleUpdate(
  db: SupabaseClient,
  req: Request,
  ctx: AdminContext,
  body: unknown,
): Promise<Response> {
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }

  const { data, error } = await db
    .from('flags')
    .update({
      status: parsed.data.status,
      reviewed_by: ctx.subject.subjectId,
      ...(parsed.data.status === 'resolved' ? { resolved_at: new Date().toISOString() } : {}),
      ...(parsed.data.note === undefined ? {} : { admin_notes: parsed.data.note }),
    })
    .eq('id', parsed.data.flagId)
    .select('id')
    .maybeSingle();
  if (error !== null) {
    serverLog.error('admin_flags.update_failed', {});
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
    entityType: ENTITY,
    entityId: parsed.data.flagId,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { flagStatus: parsed.data.status },
  });

  return jsonResponse(req, 200, { status: parsed.data.status });
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight !== null) {
    return preflight;
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return errorResponse(req, 405, 'method_not_allowed');
  }

  const segments = new URL(req.url).pathname.split('/').filter((s) => s !== '');
  const action = segments.at(-1);

  const db = createServiceClient();
  const auth = await requireAdmin(db, req, ENTITY, ['super_admin']);
  if (!auth.ok) {
    return auth.response;
  }

  if (req.method === 'GET') {
    return action === 'admin-flags'
      ? handleList(db, req, auth.ctx)
      : errorResponse(req, 404, 'not_found');
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, 400, 'invalid_request');
  }

  if (action === 'update') {
    return handleUpdate(db, req, auth.ctx, body);
  }
  return errorResponse(req, 404, 'not_found');
});
