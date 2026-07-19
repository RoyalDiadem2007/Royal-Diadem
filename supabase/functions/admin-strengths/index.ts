/**
 * admin-strengths — curation of the strengths vocabulary (SXU): the words a
 * student may claim on her Queen Card come only from this
 * administrator-approved list. super_admin until OD-12. Retire hides a word
 * from new picks without stripping it from girls who already chose it.
 *   GET  /admin-strengths            all options (active and retired)
 *   POST /admin-strengths/create     { key, label }
 *   POST /admin-strengths/toggle     { key, active }
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { z } from 'npm:zod@4';
import { createServiceClient } from '../_shared/db.ts';
import { errorResponse, handlePreflight, jsonResponse } from '../_shared/http.ts';
import { requireAdmin, type AdminContext } from '../_shared/adminAuth.ts';
import { writeAudit } from '../_shared/audit.ts';
import { serverLog } from '../_shared/logger.ts';

const ENTITY = 'strength_option';

const createSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9-]{1,40}$/),
    label: z.string().trim().min(1).max(40),
  })
  .strict();

const toggleSchema = z
  .object({ key: z.string().regex(/^[a-z0-9-]{1,40}$/), active: z.boolean() })
  .strict();

async function handleList(db: SupabaseClient, req: Request, ctx: AdminContext): Promise<Response> {
  const { data, error } = await db
    .from('strength_options')
    .select('key, label, active')
    .order('label', { ascending: true });
  if (error !== null) {
    serverLog.error('admin_strengths.list_failed', {});
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
    metadata: { returned: data.length },
  });

  return jsonResponse(req, 200, {
    options: data.map((row) => ({
      key: String(row.key),
      label: String(row.label),
      active: Boolean(row.active),
    })),
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

  const { error } = await db.from('strength_options').insert({
    key: parsed.data.key,
    label: parsed.data.label,
    created_by: ctx.subject.subjectId,
  });
  if (error !== null) {
    // 23505 = the key already exists — a friendly conflict, not a crash.
    if (error.code === '23505') {
      return errorResponse(req, 409, 'already_exists');
    }
    serverLog.error('admin_strengths.create_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  await writeAudit(db, {
    actorType: 'admin',
    actorId: ctx.subject.subjectId,
    actorRole: ctx.role,
    action: 'create',
    entityType: ENTITY,
    entityId: null,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { strengthKey: parsed.data.key },
  });

  return jsonResponse(req, 201, { created: true });
}

async function handleToggle(
  db: SupabaseClient,
  req: Request,
  ctx: AdminContext,
  body: unknown,
): Promise<Response> {
  const parsed = toggleSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }

  const { data, error } = await db
    .from('strength_options')
    .update({ active: parsed.data.active })
    .eq('key', parsed.data.key)
    .select('key')
    .maybeSingle();
  if (error !== null) {
    serverLog.error('admin_strengths.toggle_failed', {});
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
    entityId: null,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { strengthKey: parsed.data.key, active: parsed.data.active },
  });

  return jsonResponse(req, 200, { saved: true });
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
    return action === 'admin-strengths'
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
  if (action === 'toggle') {
    return handleToggle(db, req, auth.ctx, body);
  }
  return errorResponse(req, 404, 'not_found');
});
