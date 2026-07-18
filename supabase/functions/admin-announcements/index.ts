/**
 * admin-announcements — announcement management for the admin panel (Phase 9,
 * Spec §6.7 / §6.10 "Announcements": create/manage announcements).
 *   GET  /admin-announcements?page=      newest first with read counts
 *   POST /admin-announcements/create     new announcement (normal | urgent)
 *   POST /admin-announcements/delete     remove one (and its read receipts)
 *
 * super_admin only until OD-12 assigns announcement rights. Read counts
 * exclude Student Mode staff identities (staff_owner_admin_id set) on both
 * sides of the fraction — staff test activity never inflates program stats.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { z } from 'npm:zod@4';
import { createServiceClient } from '../_shared/db.ts';
import { errorResponse, handlePreflight, jsonResponse } from '../_shared/http.ts';
import { requireAdmin, type AdminContext } from '../_shared/adminAuth.ts';
import { writeAudit } from '../_shared/audit.ts';
import { serverLog } from '../_shared/logger.ts';

const ENTITY = 'announcement';
const PAGE_SIZE = 20;

const createSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(4000),
    priority: z.enum(['normal', 'urgent']),
  })
  .strict();

const deleteSchema = z.object({ announcementId: z.uuid() }).strict();

/** Read receipts per announcement, real students only (staff excluded). */
async function readCounts(
  db: SupabaseClient,
  announcementIds: readonly string[],
): Promise<Map<string, number> | null> {
  if (announcementIds.length === 0) {
    return new Map();
  }
  const { data, error } = await db
    .from('announcement_reads')
    .select('announcement_id, students!inner(staff_owner_admin_id)')
    .in('announcement_id', announcementIds)
    .is('students.staff_owner_admin_id', null);
  if (error !== null) {
    serverLog.error('admin_announcements.read_counts_failed', {});
    return null;
  }
  const counts = new Map<string, number>();
  for (const row of data as { announcement_id: string }[]) {
    const id = String(row.announcement_id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

async function handleList(db: SupabaseClient, req: Request, ctx: AdminContext): Promise<Response> {
  const pageParam = new URL(req.url).searchParams.get('page') ?? '1';
  const page = /^\d{1,6}$/.test(pageParam) ? Math.max(1, Number(pageParam)) : 1;
  const from = (page - 1) * PAGE_SIZE;

  const { data, error, count } = await db
    .from('announcements')
    .select('id, title, body, priority, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (error !== null || count === null) {
    serverLog.error('admin_announcements.list_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  const counts = await readCounts(
    db,
    data.map((a) => String(a.id)),
  );
  if (counts === null) {
    return errorResponse(req, 500, 'server_error');
  }

  const { count: activeStudents, error: studentsError } = await db
    .from('students')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active')
    .is('staff_owner_admin_id', null);
  if (studentsError !== null || activeStudents === null) {
    serverLog.error('admin_announcements.student_count_failed', {});
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
    announcements: data.map((a) => ({
      id: String(a.id),
      title: String(a.title),
      body: String(a.body),
      priority: a.priority === 'urgent' ? 'urgent' : 'normal',
      createdAt: String(a.created_at),
      readCount: counts.get(String(a.id)) ?? 0,
    })),
    activeStudents,
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
    .from('announcements')
    .insert({
      title: parsed.data.title,
      body: parsed.data.body,
      priority: parsed.data.priority,
      posted_by: ctx.subject.subjectId,
    })
    .select('id, title, body, priority, created_at')
    .single();
  if (error !== null) {
    serverLog.error('admin_announcements.create_failed', {});
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

  return jsonResponse(req, 201, {
    announcement: {
      id: String(data.id),
      title: String(data.title),
      body: String(data.body),
      priority: data.priority === 'urgent' ? 'urgent' : 'normal',
      createdAt: String(data.created_at),
      readCount: 0,
    },
  });
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
  const { announcementId } = parsed.data;

  // Receipts first (FK), then the announcement itself.
  const { error: readsError } = await db
    .from('announcement_reads')
    .delete()
    .eq('announcement_id', announcementId);
  if (readsError !== null) {
    serverLog.error('admin_announcements.reads_delete_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  const { data, error } = await db
    .from('announcements')
    .delete()
    .eq('id', announcementId)
    .select('id')
    .maybeSingle();
  if (error !== null) {
    serverLog.error('admin_announcements.delete_failed', {});
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
    entityId: announcementId,
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
    return action === 'admin-announcements'
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
  if (action === 'delete') {
    return handleDelete(db, req, auth.ctx, body);
  }
  return errorResponse(req, 404, 'not_found');
});
