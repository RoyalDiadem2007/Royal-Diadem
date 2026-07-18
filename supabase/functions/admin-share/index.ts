/**
 * admin-share — Share moderation for the admin panel (Phase 10a, Spec §6.8 /
 * §6.10 "Share Moderation"): the review queue (pending posts and comments,
 * including peer-flagged content), approve/remove decisions, and the
 * pre/post moderation-mode switch. super_admin only until OD-12. Peer flags
 * are visible here with the flagger's name — they are anonymous to students
 * only. Approve/remove resolves the entity's open peer flags in the same
 * action; "address privately" happens outside the app and lands in the
 * flag's admin note.
 *
 *   GET  /admin-share?page=       queue + current mode
 *   POST /admin-share/moderate    { entityType, entityId, action, note? }
 *   POST /admin-share/mode        { mode: 'pre' | 'post' }
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { z } from 'npm:zod@4';
import { createServiceClient } from '../_shared/db.ts';
import { errorResponse, handlePreflight, jsonResponse } from '../_shared/http.ts';
import { requireAdmin, type AdminContext } from '../_shared/adminAuth.ts';
import { writeAudit } from '../_shared/audit.ts';
import { serverLog } from '../_shared/logger.ts';
import { imagePathsOf, signedUrlsFor } from '../_shared/shareMedia.ts';

const PAGE_SIZE = 25;

const moderateSchema = z
  .object({
    entityType: z.enum(['post', 'comment']),
    entityId: z.uuid(),
    action: z.enum(['approve', 'remove']),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();

const modeSchema = z.object({ mode: z.enum(['pre', 'post']) }).strict();

type FlagRow = {
  entity_type: string;
  entity_id: string;
  created_at: string;
  students: { display_name: string } | null;
};

/** Open peer flags for the queued entities, flagger named (admins only). */
async function openFlagsFor(
  db: SupabaseClient,
  entityType: 'share_post' | 'share_comment',
  ids: readonly string[],
): Promise<Map<string, { flaggedBy: string; flaggedAt: string }> | null> {
  if (ids.length === 0) {
    return new Map();
  }
  const { data, error } = await db
    .from('flags')
    .select('entity_type, entity_id, created_at, students(display_name)')
    .eq('source', 'peer')
    .eq('entity_type', entityType)
    .in('entity_id', ids)
    .neq('status', 'resolved');
  if (error !== null) {
    serverLog.error('admin_share.flags_query_failed', {});
    return null;
  }
  const map = new Map<string, { flaggedBy: string; flaggedAt: string }>();
  for (const row of data as unknown as FlagRow[]) {
    map.set(String(row.entity_id), {
      flaggedBy: row.students?.display_name ?? 'Unknown',
      flaggedAt: String(row.created_at),
    });
  }
  return map;
}

async function handleQueue(db: SupabaseClient, req: Request, ctx: AdminContext): Promise<Response> {
  const pageParam = new URL(req.url).searchParams.get('page') ?? '1';
  const page = /^\d{1,6}$/.test(pageParam) ? Math.max(1, Number(pageParam)) : 1;
  const from = (page - 1) * PAGE_SIZE;

  const { data: posts, error: postsError, count: postCount } = await db
    .from('share_posts')
    .select('id, content_text, image_url, created_at, students!inner(display_name)', {
      count: 'exact',
    })
    .eq('moderation_status', 'pending')
    .order('created_at', { ascending: true })
    .range(from, from + PAGE_SIZE - 1);
  if (postsError !== null || postCount === null) {
    serverLog.error('admin_share.queue_posts_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  const { data: comments, error: commentsError, count: commentCount } = await db
    .from('share_comments')
    .select('id, post_id, comment_text, created_at, students!inner(display_name)', {
      count: 'exact',
    })
    .eq('moderation_status', 'pending')
    .order('created_at', { ascending: true })
    .range(from, from + PAGE_SIZE - 1);
  if (commentsError !== null || commentCount === null) {
    serverLog.error('admin_share.queue_comments_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  type QueueRow = {
    id: string;
    content_text?: string | null;
    image_url?: string | null;
    comment_text?: string;
    post_id?: string;
    created_at: string;
    students: { display_name: string };
  };
  const postRows = posts as unknown as QueueRow[];
  const commentRows = comments as unknown as QueueRow[];

  const postFlags = await openFlagsFor(db, 'share_post', postRows.map((p) => p.id));
  const commentFlags = await openFlagsFor(db, 'share_comment', commentRows.map((c) => c.id));
  if (postFlags === null || commentFlags === null) {
    return errorResponse(req, 500, 'server_error');
  }

  // The reviewer must see the photo she's judging — signed like the feed.
  const photoUrls = await signedUrlsFor(
    db,
    imagePathsOf(postRows.map((p) => ({ image_url: p.image_url ?? null }))),
  );
  if (photoUrls === null) {
    return errorResponse(req, 500, 'server_error');
  }

  const { data: modeRow, error: modeError } = await db
    .from('app_settings')
    .select('value')
    .eq('key', 'share_moderation_mode')
    .maybeSingle();
  if (modeError !== null) {
    serverLog.error('admin_share.mode_read_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  await writeAudit(db, {
    actorType: 'admin',
    actorId: ctx.subject.subjectId,
    actorRole: ctx.role,
    action: 'read',
    entityType: 'share_post',
    entityId: null,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { view: 'moderation_queue', page, posts: postRows.length, comments: commentRows.length },
  });

  return jsonResponse(req, 200, {
    mode: modeRow?.value === 'post' ? 'post' : 'pre',
    posts: postRows.map((p) => ({
      id: p.id,
      authorName: p.students.display_name,
      text: p.content_text ?? '',
      imageUrl: p.image_url == null ? null : (photoUrls.get(p.image_url) ?? null),
      createdAt: p.created_at,
      flag: postFlags.get(p.id) ?? null,
    })),
    comments: commentRows.map((c) => ({
      id: c.id,
      postId: String(c.post_id),
      authorName: c.students.display_name,
      text: c.comment_text ?? '',
      createdAt: c.created_at,
      flag: commentFlags.get(c.id) ?? null,
    })),
    page,
    pageSize: PAGE_SIZE,
    totalPosts: postCount,
    totalComments: commentCount,
  });
}

async function handleModerate(
  db: SupabaseClient,
  req: Request,
  ctx: AdminContext,
  body: unknown,
): Promise<Response> {
  const parsed = moderateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }
  const { entityType, entityId, action } = parsed.data;
  const table = entityType === 'post' ? 'share_posts' : 'share_comments';
  const flagEntityType = entityType === 'post' ? 'share_post' : 'share_comment';
  const nextStatus = action === 'approve' ? 'approved' : 'removed';

  const { data: updated, error: updateError } = await db
    .from(table)
    .update({ moderation_status: nextStatus })
    .eq('id', entityId)
    .select('id')
    .maybeSingle();
  if (updateError !== null) {
    serverLog.error('admin_share.moderate_failed', {});
    return errorResponse(req, 500, 'server_error');
  }
  if (updated === null) {
    return errorResponse(req, 404, 'not_found');
  }

  // The decision closes the entity's open peer flags in the same action.
  const { error: flagError } = await db
    .from('flags')
    .update({
      status: 'resolved',
      reviewed_by: ctx.subject.subjectId,
      resolved_at: new Date().toISOString(),
      ...(parsed.data.note === undefined ? {} : { admin_notes: parsed.data.note }),
    })
    .eq('source', 'peer')
    .eq('entity_type', flagEntityType)
    .eq('entity_id', entityId)
    .neq('status', 'resolved');
  if (flagError !== null) {
    serverLog.error('admin_share.flag_resolve_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  await writeAudit(db, {
    actorType: 'admin',
    actorId: ctx.subject.subjectId,
    actorRole: ctx.role,
    action: 'update',
    entityType: flagEntityType,
    entityId,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { moderationAction: action },
  });

  return jsonResponse(req, 200, { status: nextStatus });
}

async function handleMode(
  db: SupabaseClient,
  req: Request,
  ctx: AdminContext,
  body: unknown,
): Promise<Response> {
  const parsed = modeSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }

  const { error } = await db.from('app_settings').upsert(
    {
      key: 'share_moderation_mode',
      value: parsed.data.mode,
      updated_at: new Date().toISOString(),
      updated_by: ctx.subject.subjectId,
    },
    { onConflict: 'key' },
  );
  if (error !== null) {
    serverLog.error('admin_share.mode_write_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  await writeAudit(db, {
    actorType: 'admin',
    actorId: ctx.subject.subjectId,
    actorRole: ctx.role,
    action: 'update',
    entityType: 'app_setting',
    entityId: null,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { setting: 'share_moderation_mode', value: parsed.data.mode },
  });

  return jsonResponse(req, 200, { mode: parsed.data.mode });
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
  const auth = await requireAdmin(db, req, 'share_post', ['super_admin']);
  if (!auth.ok) {
    return auth.response;
  }

  if (req.method === 'GET') {
    return action === 'admin-share'
      ? handleQueue(db, req, auth.ctx)
      : errorResponse(req, 404, 'not_found');
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, 400, 'invalid_request');
  }

  if (action === 'moderate') {
    return handleModerate(db, req, auth.ctx, body);
  }
  if (action === 'mode') {
    return handleMode(db, req, auth.ctx, body);
  }
  return errorResponse(req, 404, 'not_found');
});
