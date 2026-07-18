/**
 * Client for the share Edge Function (Phase 10a, Spec §6.8): the student
 * side of Royal Diadem Share. Everything crosses the Edge Function — posts
 * carry student identity, so nothing here touches the Data API. Post
 * creation fetches its own Turnstile token (Spec §3 gates share posts).
 */
import { callEdgeFunction, type ApiResult } from '@/lib/api';
import { getTurnstileToken } from '@/lib/turnstile';

export type ShareComment = {
  id: string;
  authorName: string;
  mine: boolean;
  text: string;
  status: 'approved' | 'pending';
  createdAt: string;
};

export type SharePost = {
  id: string;
  authorName: string;
  mine: boolean;
  contentText: string | null;
  /** Short-lived signed URL for the post photo, or null. */
  imageUrl: string | null;
  status: 'approved' | 'pending';
  createdAt: string;
  comments: ShareComment[];
  reactions: Record<string, number>;
  myReactions: string[];
};

export type ShareFeed = {
  posts: SharePost[];
  page: number;
  pageSize: number;
  total: number;
  reactionSet: string[];
};

function asRecord(raw: unknown, what: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${what} is not an object`);
  }
  return raw as Record<string, unknown>;
}

function parseStatus(raw: unknown): 'approved' | 'pending' {
  if (raw !== 'approved' && raw !== 'pending') {
    throw new Error('moderation status is malformed');
  }
  return raw;
}

function parseComment(raw: unknown): ShareComment {
  const r = asRecord(raw, 'comment');
  if (
    typeof r.id !== 'string' ||
    typeof r.authorName !== 'string' ||
    typeof r.mine !== 'boolean' ||
    typeof r.text !== 'string' ||
    typeof r.createdAt !== 'string'
  ) {
    throw new Error('comment is malformed');
  }
  return {
    id: r.id,
    authorName: r.authorName,
    mine: r.mine,
    text: r.text,
    status: parseStatus(r.status),
    createdAt: r.createdAt,
  };
}

function parsePost(raw: unknown): SharePost {
  const r = asRecord(raw, 'post');
  if (
    typeof r.id !== 'string' ||
    typeof r.authorName !== 'string' ||
    typeof r.mine !== 'boolean' ||
    (r.contentText !== null && typeof r.contentText !== 'string') ||
    (r.imageUrl !== null && typeof r.imageUrl !== 'string') ||
    typeof r.createdAt !== 'string' ||
    !Array.isArray(r.comments) ||
    typeof r.reactions !== 'object' ||
    r.reactions === null ||
    !Array.isArray(r.myReactions)
  ) {
    throw new Error('post is malformed');
  }
  const reactions: Record<string, number> = {};
  for (const [emoji, count] of Object.entries(r.reactions as Record<string, unknown>)) {
    if (typeof count !== 'number') {
      throw new Error('reaction count is malformed');
    }
    reactions[emoji] = count;
  }
  return {
    id: r.id,
    authorName: r.authorName,
    mine: r.mine,
    contentText: r.contentText,
    imageUrl: r.imageUrl,
    status: parseStatus(r.status),
    createdAt: r.createdAt,
    comments: r.comments.map(parseComment),
    reactions,
    myReactions: r.myReactions.map((e) => {
      if (typeof e !== 'string') {
        throw new Error('my reaction is malformed');
      }
      return e;
    }),
  };
}

function parseFeed(raw: unknown): ShareFeed {
  const r = asRecord(raw, 'feed response');
  if (
    !Array.isArray(r.posts) ||
    typeof r.page !== 'number' ||
    typeof r.pageSize !== 'number' ||
    typeof r.total !== 'number' ||
    !Array.isArray(r.reactionSet)
  ) {
    throw new Error('feed response is malformed');
  }
  return {
    posts: r.posts.map(parsePost),
    page: r.page,
    pageSize: r.pageSize,
    total: r.total,
    reactionSet: r.reactionSet.map((e) => {
      if (typeof e !== 'string') {
        throw new Error('reaction set is malformed');
      }
      return e;
    }),
  };
}

export async function fetchFeed(sessionToken: string, page: number): Promise<ApiResult<ShareFeed>> {
  return callEdgeFunction(`share?page=${String(page)}`, {
    method: 'GET',
    sessionToken,
    parse: parseFeed,
  });
}

export type NewPost = { contentText?: string; photo?: File };

export async function createPost(
  sessionToken: string,
  post: NewPost,
): Promise<ApiResult<{ id: string; status: 'approved' | 'pending' }>> {
  const turnstileToken = await getTurnstileToken();
  const parse = (raw: unknown) => {
    const created = asRecord(asRecord(raw, 'post response').post, 'post');
    if (typeof created.id !== 'string') {
      throw new Error('post response is malformed');
    }
    return { id: created.id, status: parseStatus(created.status) };
  };

  if (post.photo !== undefined) {
    const formData = new FormData();
    formData.append('turnstileToken', turnstileToken);
    if (post.contentText !== undefined) {
      formData.append('contentText', post.contentText);
    }
    formData.append('photo', post.photo);
    return callEdgeFunction('share/post', { method: 'POST', sessionToken, formData, parse });
  }

  return callEdgeFunction('share/post', {
    method: 'POST',
    sessionToken,
    body: { contentText: post.contentText ?? '', turnstileToken },
    parse,
  });
}

export async function addComment(
  sessionToken: string,
  postId: string,
  commentText: string,
): Promise<ApiResult<{ id: string; status: 'approved' | 'pending' }>> {
  return callEdgeFunction('share/comment', {
    method: 'POST',
    sessionToken,
    body: { postId, commentText },
    parse: (raw) => {
      const comment = asRecord(asRecord(raw, 'comment response').comment, 'comment');
      if (typeof comment.id !== 'string') {
        throw new Error('comment response is malformed');
      }
      return { id: comment.id, status: parseStatus(comment.status) };
    },
  });
}

export async function toggleReaction(
  sessionToken: string,
  postId: string,
  emoji: string,
): Promise<ApiResult<boolean>> {
  return callEdgeFunction('share/react', {
    method: 'POST',
    sessionToken,
    body: { postId, emoji },
    parse: (raw) => {
      const r = asRecord(raw, 'react response');
      if (typeof r.reacted !== 'boolean') {
        throw new Error('react response is malformed');
      }
      return r.reacted;
    },
  });
}

export async function flagContent(
  sessionToken: string,
  entityType: 'post' | 'comment',
  entityId: string,
): Promise<ApiResult<null>> {
  return callEdgeFunction('share/flag', {
    method: 'POST',
    sessionToken,
    body: { entityType, entityId },
    parse: () => null,
  });
}
