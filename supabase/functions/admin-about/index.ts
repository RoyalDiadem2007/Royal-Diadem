/**
 * admin-about — the About Us page's two editable sections (Phase 12, Spec
 * §6.9): the Royal Diadem story and Pastor Kenecia's bio. Public content;
 * what's audited is authorship and change history. super_admin only until
 * OD-12.
 *   GET  /admin-about            both sections (missing = never written yet)
 *   POST /admin-about/update     { section, title, body }
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { z } from 'npm:zod@4';
import { createServiceClient } from '../_shared/db.ts';
import { errorResponse, handlePreflight, jsonResponse } from '../_shared/http.ts';
import { requireAdmin, type AdminContext } from '../_shared/adminAuth.ts';
import { writeAudit } from '../_shared/audit.ts';
import { serverLog } from '../_shared/logger.ts';

const ENTITY = 'about_content';

const updateSchema = z
  .object({
    section: z.enum(['about_org', 'pastor_bio']),
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(8000),
  })
  .strict();

type Row = { section: string; title: string; body: string; updated_at: string };

async function handleGet(db: SupabaseClient, req: Request, ctx: AdminContext): Promise<Response> {
  const { data, error } = await db
    .from('about_content')
    .select('section, title, body, updated_at');
  if (error !== null) {
    serverLog.error('admin_about.list_failed', {});
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
    sections: (data as Row[]).map((row) => ({
      section: row.section,
      title: row.title,
      body: row.body,
      updatedAt: row.updated_at,
    })),
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

  const { error } = await db.from('about_content').upsert(
    {
      section: parsed.data.section,
      title: parsed.data.title,
      body: parsed.data.body,
      updated_by: ctx.subject.subjectId,
    },
    { onConflict: 'section' },
  );
  if (error !== null) {
    serverLog.error('admin_about.update_failed', {});
    return errorResponse(req, 500, 'server_error');
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
    metadata: { section: parsed.data.section },
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
    return action === 'admin-about'
      ? handleGet(db, req, auth.ctx)
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
