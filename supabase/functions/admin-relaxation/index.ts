/**
 * admin-relaxation — curation of the calming library (Phase 11, Spec §6.3):
 * affirmations, scripture, and grounding prompts the girls see in the Relax
 * room. super_admin only until OD-12. Content is public program material;
 * what's audited here is authorship and change history.
 *   GET  /admin-relaxation?page=      all rows (active and retired)
 *   POST /admin-relaxation/create     { kind, title, body }
 *   POST /admin-relaxation/update     { itemId, kind, title, body, active, sortOrder }
 *   POST /admin-relaxation/delete     { itemId }
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { z } from 'npm:zod@4';
import { createServiceClient } from '../_shared/db.ts';
import { errorResponse, handlePreflight, jsonResponse } from '../_shared/http.ts';
import { requireAdmin, type AdminContext } from '../_shared/adminAuth.ts';
import { writeAudit } from '../_shared/audit.ts';
import { serverLog } from '../_shared/logger.ts';

const ENTITY = 'relaxation_content';
const PAGE_SIZE = 50;

const KINDS = ['affirmation', 'scripture', 'grounding'] as const;

const createSchema = z
  .object({
    kind: z.enum(KINDS),
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(2000),
  })
  .strict();

const updateSchema = z
  .object({
    itemId: z.uuid(),
    kind: z.enum(KINDS),
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(2000),
    active: z.boolean(),
    sortOrder: z.number().int().min(0).max(10_000),
  })
  .strict();

const deleteSchema = z.object({ itemId: z.uuid() }).strict();

const COLUMNS = 'id, kind, title, body, active, sort_order, created_at';

type Row = {
  id: string;
  kind: string;
  title: string;
  body: string;
  active: boolean;
  sort_order: number;
  created_at: string;
};

function toWire(row: Row) {
  return {
    id: String(row.id),
    kind: row.kind,
    title: row.title,
    body: row.body,
    active: row.active,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

async function handleList(db: SupabaseClient, req: Request, ctx: AdminContext): Promise<Response> {
  const pageParam = new URL(req.url).searchParams.get('page') ?? '1';
  const page = /^\d{1,6}$/.test(pageParam) ? Math.max(1, Number(pageParam)) : 1;
  const from = (page - 1) * PAGE_SIZE;

  const { data, error, count } = await db
    .from('relaxation_content')
    .select(COLUMNS, { count: 'exact' })
    .order('kind', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
    .range(from, from + PAGE_SIZE - 1);
  if (error !== null || count === null) {
    serverLog.error('admin_relaxation.list_failed', {});
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
    metadata: { view: 'list', page, returned: data.length },
  });

  return jsonResponse(req, 200, {
    items: (data as Row[]).map(toWire),
    page,
    pageSize: PAGE_SIZE,
    total: count,
  });
}

async function handleCreate(
  db: SupabaseClient,
  req: Request,
  ctx: AdminContext,
  body: unknown,
): Promise<Response> {
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }

  const { data, error } = await db
    .from('relaxation_content')
    .insert({
      kind: parsed.data.kind,
      title: parsed.data.title,
      body: parsed.data.body,
      created_by: ctx.subject.subjectId,
    })
    .select(COLUMNS)
    .single();
  if (error !== null) {
    serverLog.error('admin_relaxation.create_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  await writeAudit(db, {
    actorType: 'admin',
    actorId: ctx.subject.subjectId,
    actorRole: ctx.role,
    action: 'create',
    entityType: ENTITY,
    entityId: String(data.id),
    outcome: 'allowed',
    ip: ctx.ip,
  });

  return jsonResponse(req, 201, { item: toWire(data as Row) });
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
    .from('relaxation_content')
    .update({
      kind: parsed.data.kind,
      title: parsed.data.title,
      body: parsed.data.body,
      active: parsed.data.active,
      sort_order: parsed.data.sortOrder,
    })
    .eq('id', parsed.data.itemId)
    .select(COLUMNS)
    .maybeSingle();
  if (error !== null) {
    serverLog.error('admin_relaxation.update_failed', {});
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
    entityId: parsed.data.itemId,
    outcome: 'allowed',
    ip: ctx.ip,
  });

  return jsonResponse(req, 200, { item: toWire(data as Row) });
}

async function handleDelete(
  db: SupabaseClient,
  req: Request,
  ctx: AdminContext,
  body: unknown,
): Promise<Response> {
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }

  const { data, error } = await db
    .from('relaxation_content')
    .delete()
    .eq('id', parsed.data.itemId)
    .select('id')
    .maybeSingle();
  if (error !== null) {
    serverLog.error('admin_relaxation.delete_failed', {});
    return errorResponse(req, 500, 'server_error');
  }
  if (data === null) {
    return errorResponse(req, 404, 'not_found');
  }

  await writeAudit(db, {
    actorType: 'admin',
    actorId: ctx.subject.subjectId,
    actorRole: ctx.role,
    action: 'delete',
    entityType: ENTITY,
    entityId: parsed.data.itemId,
    outcome: 'allowed',
    ip: ctx.ip,
  });

  return jsonResponse(req, 200, { deleted: true });
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
    return action === 'admin-relaxation'
      ? handleList(db, req, auth.ctx)
      : errorResponse(req, 404, 'not_found');
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, 400, 'invalid_request');
  }

  if (action === 'create') {
    return handleCreate(db, req, auth.ctx, body);
  }
  if (action === 'update') {
    return handleUpdate(db, req, auth.ctx, body);
  }
  if (action === 'delete') {
    return handleDelete(db, req, auth.ctx, body);
  }
  return errorResponse(req, 404, 'not_found');
});
