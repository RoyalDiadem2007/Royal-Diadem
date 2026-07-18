/**
 * share — the student side of Royal Diadem Share (Phase 10a, Spec §6.8):
 * text posts, comments, crown-themed reactions, and the peer flag. This is
 * a SAFE SPACE; the moderation architecture protects that:
 *   - Feed shows approved content plus the caller's own pending items
 *     (labeled client-side); removed content is gone for everyone.
 *   - New posts/comments enter 'pending' or 'approved' per the
 *     share_moderation_mode setting ('pre' is the default and the fallback
 *     whenever the setting can't be read — never fail open).
 *   - A peer flag ("Something doesn't feel right") auto-hides the content
 *     by resetting it to 'pending' and records a flag row — anonymous to
 *     students, visible to admins. Responses never reveal flag state.
 * Turnstile gates post creation (Spec §3); every write kind is rate limited
 * per student; every read/write of student content is audit-logged.
 *
 *   GET  /share?page=          the feed
 *   POST /share/post           { contentText, turnstileToken }
 *   POST /share/comment        { postId, commentText }
 *   POST /share/react          { postId, emoji }  (toggle)
 *   POST /share/flag           { entityType: 'post'|'comment', entityId }
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { z } from 'npm:zod@4';
import { createServiceClient } from '../_shared/db.ts';
import { errorResponse, handlePreflight, jsonResponse } from '../_shared/http.ts';
import { requireStudent, type StudentContext } from '../_shared/studentAuth.ts';
import { verifyTurnstile } from '../_shared/turnstile.ts';
import { enforceShareWriteRateLimit, type ShareWriteKind } from '../_shared/rateLimit.ts';
import { writeAudit } from '../_shared/audit.ts';
import { serverLog } from '../_shared/logger.ts';

const PAGE_SIZE = 20;

/** The approved crown-themed reaction set (Spec §6.8) — server allowlist. */
const REACTION_SET = ['👑', '💎', '🦩', '👏', '✨', '💪', '🌹', '🎉', '💖', '🔥'] as const;

const postSchema = z
  .object({
    contentText: z.string().trim().min(1).max(1000),
    turnstileToken: z.string().min(10).max(2048),
  })
  .strict();

const commentSchema = z
  .object({ postId: z.uuid(), commentText: z.string().trim().min(1).max(500) })
  .strict();

const reactSchema = z
  .object({ postId: z.uuid(), emoji: z.enum(REACTION_SET) })
  .strict();

const flagSchema = z
  .object({ entityType: z.enum(['post', 'comment']), entityId: z.uuid() })
  .strict();

type ModerationMode = 'pre' | 'post';

/** Reads the share moderation mode; anything unreadable is 'pre' (fail safe). */
async function moderationMode(db: SupabaseClient): Promise<ModerationMode> {
  const { data, error } = await db
    .from('app_settings')
    .select('value')
    .eq('key', 'share_moderation_mode')
    .maybeSingle();
  if (error !== null) {
    serverLog.error('share.mode_read_failed', {});
    return 'pre';
  }
  return data?.value === 'post' ? 'post' : 'pre';
}

async function enforceLimit(
  db: SupabaseClient,
  req: Request,
  kind: ShareWriteKind,
  studentId: string,
): Promise<Response | null> {
  const limit = await enforceShareWriteRateLimit(db, kind, studentId);
  if (!limit.allowed) {
    return errorResponse(req, 429, 'rate_limited', {
      'Retry-After': String(limit.retryAfterSeconds),
    });
  }
  return null;
}

type PostRow = {
  id: string;
  student_id: string;
  content_text: string | null;
  moderation_status: string;
  created_at: string;
  students: { display_name: string };
};

type CommentRow = {
  id: string;
  post_id: string;
  student_id: string;
  comment_text: string;
  moderation_status: string;
  created_at: string;
  students: { display_name: string };
};

type ReactionRow = { post_id: string; student_id: string; emoji: string };

async function handleFeed(db: SupabaseClient, req: Request, ctx: StudentContext): Promise<Response> {
  const pageParam = new URL(req.url).searchParams.get('page') ?? '1';
  const page = /^\d{1,6}$/.test(pageParam) ? Math.max(1, Number(pageParam)) : 1;
  const from = (page - 1) * PAGE_SIZE;
  const self = ctx.subject.subjectId;

  const { data: posts, error, count } = await db
    .from('share_posts')
    .select('id, student_id, content_text, moderation_status, created_at, students!inner(display_name)', {
      count: 'exact',
    })
    .or(`moderation_status.eq.approved,and(student_id.eq.${self},moderation_status.eq.pending)`)
    .order('created_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (error !== null || count === null) {
    serverLog.error('share.feed_failed', {});
    return errorResponse(req, 500, 'server_error');
  }
  const postRows = posts as unknown as PostRow[];
  const postIds = postRows.map((p) => p.id);

  let commentRows: CommentRow[] = [];
  let reactionRows: ReactionRow[] = [];
  if (postIds.length > 0) {
    const { data: comments, error: commentsError } = await db
      .from('share_comments')
      .select('id, post_id, student_id, comment_text, moderation_status, created_at, students!inner(display_name)')
      .in('post_id', postIds)
      .or(`moderation_status.eq.approved,and(student_id.eq.${self},moderation_status.eq.pending)`)
      .order('created_at', { ascending: true });
    if (commentsError !== null) {
      serverLog.error('share.comments_failed', {});
      return errorResponse(req, 500, 'server_error');
    }
    commentRows = comments as unknown as CommentRow[];

    const { data: reactions, error: reactionsError } = await db
      .from('share_reactions')
      .select('post_id, student_id, emoji')
      .in('post_id', postIds);
    if (reactionsError !== null) {
      serverLog.error('share.reactions_failed', {});
      return errorResponse(req, 500, 'server_error');
    }
    reactionRows = reactions as ReactionRow[];
  }

  const feed = postRows.map((post) => {
    const postReactions = reactionRows.filter((r) => r.post_id === post.id);
    const counts: Record<string, number> = {};
    for (const r of postReactions) {
      counts[r.emoji] = (counts[r.emoji] ?? 0) + 1;
    }
    return {
      id: post.id,
      authorName: post.students.display_name,
      mine: post.student_id === self,
      contentText: post.content_text,
      // Only 'approved' or (own) 'pending' rows can be here; the client uses
      // pending to show the author her "waiting for review" label.
      status: post.moderation_status === 'approved' ? 'approved' : 'pending',
      createdAt: post.created_at,
      comments: commentRows
        .filter((c) => c.post_id === post.id)
        .map((c) => ({
          id: c.id,
          authorName: c.students.display_name,
          mine: c.student_id === self,
          text: c.comment_text,
          status: c.moderation_status === 'approved' ? 'approved' : 'pending',
          createdAt: c.created_at,
        })),
      reactions: counts,
      myReactions: postReactions.filter((r) => r.student_id === self).map((r) => r.emoji),
    };
  });

  await writeAudit(db, {
    actorType: 'student',
    actorId: self,
    actorRole: 'student',
    action: 'read',
    entityType: 'share_post',
    entityId: null,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { view: 'feed', page, returned: feed.length },
  });

  return jsonResponse(req, 200, {
    posts: feed,
    page,
    pageSize: PAGE_SIZE,
    total: count,
    reactionSet: [...REACTION_SET],
  });
}

async function handlePost(
  db: SupabaseClient,
  req: Request,
  ctx: StudentContext,
  body: unknown,
): Promise<Response> {
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }

  // Turnstile first (Spec §3: gates who can attempt), then the rate limit.
  const turnstile = await verifyTurnstile(parsed.data.turnstileToken, ctx.ip);
  if (!turnstile.ok) {
    return errorResponse(req, 403, 'turnstile_failed');
  }
  const limited = await enforceLimit(db, req, 'post', ctx.subject.subjectId);
  if (limited !== null) {
    return limited;
  }

  const status = (await moderationMode(db)) === 'post' ? 'approved' : 'pending';
  const { data, error } = await db
    .from('share_posts')
    .insert({
      student_id: ctx.subject.subjectId,
      post_type: 'text',
      content_text: parsed.data.contentText,
      moderation_status: status,
    })
    .select('id, moderation_status, created_at')
    .single();
  if (error !== null) {
    serverLog.error('share.post_insert_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  await writeAudit(db, {
    actorType: 'student',
    actorId: ctx.subject.subjectId,
    actorRole: 'student',
    action: 'create',
    entityType: 'share_post',
    entityId: String(data.id),
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { moderationStatus: status },
  });

  return jsonResponse(req, 201, {
    post: { id: String(data.id), status, createdAt: String(data.created_at) },
  });
}

async function handleComment(
  db: SupabaseClient,
  req: Request,
  ctx: StudentContext,
  body: unknown,
): Promise<Response> {
  const parsed = commentSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }
  const limited = await enforceLimit(db, req, 'comment', ctx.subject.subjectId);
  if (limited !== null) {
    return limited;
  }

  // Comments attach to visible (approved) posts only.
  const { data: post, error: postError } = await db
    .from('share_posts')
    .select('id')
    .eq('id', parsed.data.postId)
    .eq('moderation_status', 'approved')
    .maybeSingle();
  if (postError !== null) {
    serverLog.error('share.comment_post_lookup_failed', {});
    return errorResponse(req, 500, 'server_error');
  }
  if (post === null) {
    return errorResponse(req, 404, 'not_found');
  }

  const status = (await moderationMode(db)) === 'post' ? 'approved' : 'pending';
  const { data, error } = await db
    .from('share_comments')
    .insert({
      post_id: parsed.data.postId,
      student_id: ctx.subject.subjectId,
      comment_text: parsed.data.commentText,
      moderation_status: status,
    })
    .select('id, created_at')
    .single();
  if (error !== null) {
    serverLog.error('share.comment_insert_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  await writeAudit(db, {
    actorType: 'student',
    actorId: ctx.subject.subjectId,
    actorRole: 'student',
    action: 'create',
    entityType: 'share_comment',
    entityId: String(data.id),
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { postId: parsed.data.postId, moderationStatus: status },
  });

  return jsonResponse(req, 201, {
    comment: { id: String(data.id), status, createdAt: String(data.created_at) },
  });
}

async function handleReact(
  db: SupabaseClient,
  req: Request,
  ctx: StudentContext,
  body: unknown,
): Promise<Response> {
  const parsed = reactSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }
  const limited = await enforceLimit(db, req, 'react', ctx.subject.subjectId);
  if (limited !== null) {
    return limited;
  }

  const { data: post, error: postError } = await db
    .from('share_posts')
    .select('id')
    .eq('id', parsed.data.postId)
    .eq('moderation_status', 'approved')
    .maybeSingle();
  if (postError !== null) {
    serverLog.error('share.react_post_lookup_failed', {});
    return errorResponse(req, 500, 'server_error');
  }
  if (post === null) {
    return errorResponse(req, 404, 'not_found');
  }

  const self = ctx.subject.subjectId;
  const { data: existing, error: existingError } = await db
    .from('share_reactions')
    .select('id')
    .eq('post_id', parsed.data.postId)
    .eq('student_id', self)
    .eq('emoji', parsed.data.emoji)
    .maybeSingle();
  if (existingError !== null) {
    serverLog.error('share.react_lookup_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  let reacted: boolean;
  if (existing !== null) {
    const { error: deleteError } = await db
      .from('share_reactions')
      .delete()
      .eq('id', String(existing.id));
    if (deleteError !== null) {
      serverLog.error('share.react_delete_failed', {});
      return errorResponse(req, 500, 'server_error');
    }
    reacted = false;
  } else {
    // The unique index makes a double-tap race harmless (23505 = duplicate).
    const { error: insertError } = await db.from('share_reactions').insert({
      post_id: parsed.data.postId,
      student_id: self,
      emoji: parsed.data.emoji,
    });
    if (insertError !== null && insertError.code !== '23505') {
      serverLog.error('share.react_insert_failed', {});
      return errorResponse(req, 500, 'server_error');
    }
    reacted = true;
  }

  await writeAudit(db, {
    actorType: 'student',
    actorId: self,
    actorRole: 'student',
    action: reacted ? 'create' : 'delete',
    entityType: 'share_reaction',
    entityId: null,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { postId: parsed.data.postId },
  });

  return jsonResponse(req, 200, { reacted });
}

async function handleFlag(
  db: SupabaseClient,
  req: Request,
  ctx: StudentContext,
  body: unknown,
): Promise<Response> {
  const parsed = flagSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }
  const limited = await enforceLimit(db, req, 'flag', ctx.subject.subjectId);
  if (limited !== null) {
    return limited;
  }

  const table = parsed.data.entityType === 'post' ? 'share_posts' : 'share_comments';
  const flagEntityType = parsed.data.entityType === 'post' ? 'share_post' : 'share_comment';

  const { data: entity, error: entityError } = await db
    .from(table)
    .select('id, moderation_status')
    .eq('id', parsed.data.entityId)
    .maybeSingle();
  if (entityError !== null) {
    serverLog.error('share.flag_lookup_failed', {});
    return errorResponse(req, 500, 'server_error');
  }
  if (entity === null || entity.moderation_status === 'removed') {
    return errorResponse(req, 404, 'not_found');
  }

  // Auto-hide first (the safety property), then record the flag. One open
  // peer flag per entity is enough — repeats don't stack rows.
  const { error: hideError } = await db
    .from(table)
    .update({ moderation_status: 'pending' })
    .eq('id', parsed.data.entityId);
  if (hideError !== null) {
    serverLog.error('share.flag_hide_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  const { data: openFlags, error: openError } = await db
    .from('flags')
    .select('id')
    .eq('source', 'peer')
    .eq('entity_type', flagEntityType)
    .eq('entity_id', parsed.data.entityId)
    .neq('status', 'resolved');
  if (openError !== null) {
    serverLog.error('share.flag_open_lookup_failed', {});
    return errorResponse(req, 500, 'server_error');
  }
  if (openFlags.length === 0) {
    const { error: flagError } = await db.from('flags').insert({
      source: 'peer',
      entity_type: flagEntityType,
      entity_id: parsed.data.entityId,
      flagged_by: ctx.subject.subjectId,
      severity: 'medium',
      status: 'new',
    });
    if (flagError !== null) {
      serverLog.error('share.flag_insert_failed', {});
      return errorResponse(req, 500, 'server_error');
    }
  }

  await writeAudit(db, {
    actorType: 'student',
    actorId: ctx.subject.subjectId,
    actorRole: 'student',
    action: 'create',
    entityType: 'flag',
    entityId: parsed.data.entityId,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { source: 'peer', flaggedEntityType: flagEntityType },
  });

  // The response never confirms more than receipt — flags are anonymous.
  return jsonResponse(req, 200, { received: true });
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
  const auth = await requireStudent(db, req, 'share_post');
  if (!auth.ok) {
    return auth.response;
  }

  if (req.method === 'GET') {
    return action === 'share'
      ? handleFeed(db, req, auth.ctx)
      : errorResponse(req, 404, 'not_found');
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, 400, 'invalid_request');
  }

  if (action === 'post') {
    return handlePost(db, req, auth.ctx, body);
  }
  if (action === 'comment') {
    return handleComment(db, req, auth.ctx, body);
  }
  if (action === 'react') {
    return handleReact(db, req, auth.ctx, body);
  }
  if (action === 'flag') {
    return handleFlag(db, req, auth.ctx, body);
  }
  return errorResponse(req, 404, 'not_found');
});
