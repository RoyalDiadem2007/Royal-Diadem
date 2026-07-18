/**
 * Client for the admin-share Edge Function (Phase 10a): the moderation
 * queue, approve/remove decisions, and the pre/post moderation-mode switch.
 */
import { callEdgeFunction, type ApiResult } from '@/lib/api';

export type ModerationMode = 'pre' | 'post';

export type QueuedFlag = { flaggedBy: string; flaggedAt: string };

export type QueuedPost = {
  id: string;
  authorName: string;
  text: string;
  /** Short-lived signed URL for a pending photo (posts only), or null. */
  imageUrl: string | null;
  createdAt: string;
  flag: QueuedFlag | null;
};

export type QueuedComment = QueuedPost & { postId: string };

export type ModerationQueue = {
  mode: ModerationMode;
  posts: QueuedPost[];
  comments: QueuedComment[];
  page: number;
  pageSize: number;
  totalPosts: number;
  totalComments: number;
};

function asRecord(raw: unknown, what: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${what} is not an object`);
  }
  return raw as Record<string, unknown>;
}

function parseFlag(raw: unknown): QueuedFlag | null {
  if (raw === null) {
    return null;
  }
  const r = asRecord(raw, 'flag');
  if (typeof r.flaggedBy !== 'string' || typeof r.flaggedAt !== 'string') {
    throw new Error('flag is malformed');
  }
  return { flaggedBy: r.flaggedBy, flaggedAt: r.flaggedAt };
}

function parseQueuedPost(raw: unknown): QueuedPost {
  const r = asRecord(raw, 'queued post');
  if (
    typeof r.id !== 'string' ||
    typeof r.authorName !== 'string' ||
    typeof r.text !== 'string' ||
    typeof r.createdAt !== 'string'
  ) {
    throw new Error('queued post is malformed');
  }
  return {
    id: r.id,
    authorName: r.authorName,
    text: r.text,
    // Comments carry no photo; their rows simply omit the field.
    imageUrl: typeof r.imageUrl === 'string' ? r.imageUrl : null,
    createdAt: r.createdAt,
    flag: parseFlag(r.flag),
  };
}

function parseQueue(raw: unknown): ModerationQueue {
  const r = asRecord(raw, 'queue response');
  if (
    (r.mode !== 'pre' && r.mode !== 'post') ||
    !Array.isArray(r.posts) ||
    !Array.isArray(r.comments) ||
    typeof r.page !== 'number' ||
    typeof r.pageSize !== 'number' ||
    typeof r.totalPosts !== 'number' ||
    typeof r.totalComments !== 'number'
  ) {
    throw new Error('queue response is malformed');
  }
  return {
    mode: r.mode,
    posts: r.posts.map(parseQueuedPost),
    comments: r.comments.map((entry) => {
      const base = parseQueuedPost(entry);
      const record = asRecord(entry, 'queued comment');
      if (typeof record.postId !== 'string') {
        throw new Error('queued comment is malformed');
      }
      return { ...base, postId: record.postId };
    }),
    page: r.page,
    pageSize: r.pageSize,
    totalPosts: r.totalPosts,
    totalComments: r.totalComments,
  };
}

export async function fetchQueue(
  sessionToken: string,
  page: number,
): Promise<ApiResult<ModerationQueue>> {
  return callEdgeFunction(`admin-share?page=${String(page)}`, {
    method: 'GET',
    sessionToken,
    parse: parseQueue,
  });
}

export async function moderate(
  sessionToken: string,
  entityType: 'post' | 'comment',
  entityId: string,
  action: 'approve' | 'remove',
  note?: string,
): Promise<ApiResult<null>> {
  return callEdgeFunction('admin-share/moderate', {
    method: 'POST',
    sessionToken,
    body: { entityType, entityId, action, ...(note === undefined ? {} : { note }) },
    parse: () => null,
  });
}

export async function setModerationMode(
  sessionToken: string,
  mode: ModerationMode,
): Promise<ApiResult<null>> {
  return callEdgeFunction('admin-share/mode', {
    method: 'POST',
    sessionToken,
    body: { mode },
    parse: () => null,
  });
}
