/**
 * END-TO-END Royal Diadem Share tests (Phase 10a) — no mocks. Real HTTP →
 * the real share / admin-share Edge Functions → real Postgres: real
 * moderation modes, real peer-flag auto-hide, real flags rows, real RBAC,
 * real audit entries. Turnstile uses the local stack's always-pass TEST
 * secret, exactly like login.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  anonKey,
  callFunction,
  restDelete,
  restInsert,
  restSelect,
  restUpdate,
  serviceKey,
  API_URL,
} from './stack.ts';

// bcrypt(12) of '123456' — fixture PIN for the E2E accounts (local stack only).
const PIN_HASH_123456 = '$2b$12$6dESXMU6poUgaUoSTSce.ezSDJsy6vs4Pn4Ho5DFPOxoaxxXpRjMq';
const PIN = '123456';
const TURNSTILE_TOKEN = 'e2e-test-token-XXXX.DUMMY.TOKEN.XXXX';

// Distinct fixture namespace — other suites clean different prefixes.
const POSTER_CODE = 'rd-e2esh-a';
const PEER_CODE = 'rd-e2esh-b';
const SUPER_EMAIL = 'e2e-sh-super@example.com';
const MENTOR_EMAIL = 'e2e-sh-mentor@example.com';
const MARK = 'rd-e2esh';

let posterId = '';
let peerId = '';
let posterToken = '';
let peerToken = '';
let superToken = '';
let mentorToken = '';

function requireId(row: Record<string, unknown> | undefined, what: string): string {
  const id = row?.id;
  if (typeof id !== 'string' || id === '') {
    throw new Error(`seeding ${what} failed`);
  }
  return id;
}

async function login(subjectType: 'student' | 'admin', identifier: string): Promise<string> {
  const res = await callFunction('auth-login', {
    method: 'POST',
    body: { subjectType, identifier, pin: PIN, turnstileToken: TURNSTILE_TOKEN },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { token?: string };
  if (typeof body.token !== 'string') {
    throw new Error('login fixture did not return a token');
  }
  return body.token;
}

type FeedPost = {
  id: string;
  authorName: string;
  mine: boolean;
  contentText: string | null;
  imageUrl: string | null;
  status: string;
  comments: { id: string; text: string; status: string; mine: boolean }[];
  reactions: Record<string, number>;
  myReactions: string[];
};

/** The raw feed (no MARK filter) — for photo-only posts with null text. */
async function rawFeedFor(token: string): Promise<FeedPost[]> {
  const res = await callFunction('share?page=1', { method: 'GET', bearer: token });
  expect(res.status).toBe(200);
  return ((await res.json()) as { posts: FeedPost[] }).posts;
}

async function feedFor(token: string): Promise<FeedPost[]> {
  const res = await callFunction('share?page=1', { method: 'GET', bearer: token });
  expect(res.status).toBe(200);
  return ((await res.json()) as { posts: FeedPost[] }).posts.filter(
    (p) => p.contentText?.startsWith(MARK) === true,
  );
}

async function setMode(mode: 'pre' | 'post'): Promise<void> {
  const res = await callFunction('admin-share/mode', {
    method: 'POST',
    bearer: superToken,
    body: { mode },
  });
  expect(res.status).toBe(200);
}

// A real, valid 1x1 PNG — the smallest honest image for the upload path.
const TINY_PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

/** Posts multipart to the share function exactly as the browser would. */
async function postMultipart(
  token: string,
  fields: { contentText?: string; photo?: { bytes: Uint8Array; name: string; type: string } },
): Promise<Response> {
  const form = new FormData();
  form.append('turnstileToken', TURNSTILE_TOKEN);
  if (fields.contentText !== undefined) {
    form.append('contentText', fields.contentText);
  }
  if (fields.photo !== undefined) {
    // Copy into a fresh buffer: File wants Uint8Array<ArrayBuffer>, and a
    // plain copy satisfies it without any type assertion.
    const copy = new Uint8Array(fields.photo.bytes.length);
    copy.set(fields.photo.bytes);
    form.append('photo', new File([copy], fields.photo.name, { type: fields.photo.type }));
  }
  return fetch(`${API_URL}/functions/v1/share/post`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
}

/**
 * Signed URLs minted inside the functions container use its internal
 * SUPABASE_URL (kong) — unreachable from the test host. Same path, local
 * origin. Hosted deployments have a public SUPABASE_URL, so this rewrite is
 * a local-stack accommodation only.
 */
function toLocalUrl(signedUrl: string): string {
  const parsed = new URL(signedUrl);
  return `${API_URL}${parsed.pathname}${parsed.search}`;
}

async function deleteStorageObjects(paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    const res = await fetch(`${API_URL}/storage/v1/object/share-media/${path}`, {
      method: 'DELETE',
      headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}` },
    });
    if (!res.ok && res.status !== 404 && res.status !== 400) {
      throw new Error(`storage cleanup failed for ${path}: ${String(res.status)}`);
    }
  }
}

async function cleanup(): Promise<void> {
  const fixtureStudents = await restSelect('students', 'login_code=like.rd-e2esh-%&select=id');
  if (fixtureStudents.length > 0) {
    const owned = await restSelect(
      'share_posts',
      `student_id=in.(${fixtureStudents.map((s) => String(s.id)).join(',')})&image_url=not.is.null&select=image_url`,
    );
    await deleteStorageObjects(owned.map((p) => String(p.image_url)));
  }
  const posts = await restSelect('share_posts', `content_text=like.${MARK}%&select=id`);
  const photoPosts =
    fixtureStudents.length > 0
      ? await restSelect(
          'share_posts',
          `student_id=in.(${fixtureStudents.map((s) => String(s.id)).join(',')})&select=id`,
        )
      : [];
  const postIds = [...new Set([...posts, ...photoPosts].map((p) => String(p.id)))];
  if (postIds.length > 0) {
    const comments = await restSelect(
      'share_comments',
      `post_id=in.(${postIds.join(',')})&select=id`,
    );
    const commentIds = comments.map((c) => String(c.id));
    const flagTargets = [...postIds, ...commentIds];
    // Flags are append-only by design (no DELETE grant); resolve leftovers.
    await restUpdate('flags', `entity_id=in.(${flagTargets.join(',')})`, { status: 'resolved' });
    await restDelete('share_reactions', `post_id=in.(${postIds.join(',')})`);
    if (commentIds.length > 0) {
      await restDelete('share_comments', `id=in.(${commentIds.join(',')})`);
    }
    await restDelete('share_posts', `id=in.(${postIds.join(',')})`);
  }
  const students = await restSelect('students', 'login_code=like.rd-e2esh-%&select=id');
  if (students.length > 0) {
    const ids = students.map((s) => String(s.id)).join(',');
    await restDelete('sessions', `subject_id=in.(${ids})`);
    // Peer flags keep an FK to their flagger; detach the fixture students so
    // they can be deleted (flag rows themselves stay — append-only table).
    await restUpdate('flags', `flagged_by=in.(${ids})`, { flagged_by: null });
  }
  const admins = await restSelect(
    'admin_users',
    `email=in.(${SUPER_EMAIL},${MENTOR_EMAIL})&select=id`,
  );
  if (admins.length > 0) {
    const adminIds = admins.map((a) => String(a.id)).join(',');
    await restDelete('sessions', `subject_id=in.(${adminIds})`);
    // Same FK-detach treatment: moderation decisions and the mode setting
    // reference the fixture admins.
    await restUpdate('flags', `reviewed_by=in.(${adminIds})`, { reviewed_by: null });
    await restUpdate('app_settings', `updated_by=in.(${adminIds})`, { updated_by: null });
  }
  await restDelete('auth_rate_limits', 'limit_key=like.share%');
  await restDelete('auth_rate_limits', 'limit_key=like.login%');
  await restDelete('students', 'login_code=like.rd-e2esh-%');
  await restDelete('admin_users', `email=in.(${SUPER_EMAIL},${MENTOR_EMAIL})`);
  // The suite toggles the moderation mode; leave the default behind.
  await restUpdate('app_settings', 'key=eq.share_moderation_mode', { value: 'pre' });
}

beforeAll(async () => {
  const reachable = await fetch(`${API_URL}/rest/v1/`, { method: 'HEAD' })
    .then((ping) => ping.status < 500)
    .catch(() => false);
  if (!reachable) {
    throw new Error(
      `Local Supabase stack is not reachable at ${API_URL}. Run: npx supabase start && npx supabase functions serve --env-file supabase/functions/.env`,
    );
  }

  await cleanup();

  await restInsert('admin_users', [
    { name: 'Share Super', role: 'super_admin', pin_hash: PIN_HASH_123456, email: SUPER_EMAIL },
    { name: 'Share Mentor', role: 'mentor', pin_hash: PIN_HASH_123456, email: MENTOR_EMAIL },
  ]);

  const students = await restInsert('students', [
    {
      first_name: 'Amara',
      last_name: 'Share',
      display_name: 'Amara',
      date_of_birth: '2011-04-01',
      pin_hash: PIN_HASH_123456,
      login_code: POSTER_CODE,
      status: 'active',
      coppa_required: false,
      coppa_consent_status: 'verified',
    },
    {
      first_name: 'Bree',
      last_name: 'Share',
      display_name: 'Bree',
      date_of_birth: '2012-05-02',
      pin_hash: PIN_HASH_123456,
      login_code: PEER_CODE,
      status: 'active',
      coppa_required: false,
      coppa_consent_status: 'verified',
    },
  ]);
  posterId = requireId(students[0], 'students');
  peerId = requireId(students[1], 'students');

  posterToken = await login('student', POSTER_CODE);
  peerToken = await login('student', PEER_CODE);
  superToken = await login('admin', SUPER_EMAIL);
  mentorToken = await login('admin', MENTOR_EMAIL);
});

afterAll(cleanup);

describe('share Edge Function (E2E, no mocks)', () => {
  let postId = '';
  let commentId = '';

  it('pre-approval mode: a new post waits, visible only to its author', async () => {
    const res = await callFunction('share/post', {
      method: 'POST',
      bearer: posterToken,
      body: { contentText: `${MARK} I finished my first week!`, turnstileToken: TURNSTILE_TOKEN },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { post: { id: string; status: string } };
    expect(body.post.status).toBe('pending');
    postId = body.post.id;

    const posterFeed = await feedFor(posterToken);
    expect(posterFeed.some((p) => p.id === postId && p.mine && p.status === 'pending')).toBe(true);

    const peerFeed = await feedFor(peerToken);
    expect(peerFeed.some((p) => p.id === postId)).toBe(false);

    const audits = await restSelect(
      'audit_logs',
      `entity_id=eq.${postId}&entity_type=eq.share_post&action=eq.create&select=actor_id,outcome`,
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actor_id).toBe(posterId);
  });

  it('admin approval publishes the post to everyone', async () => {
    const queueRes = await callFunction('admin-share?page=1', {
      method: 'GET',
      bearer: superToken,
    });
    expect(queueRes.status).toBe(200);
    const queue = (await queueRes.json()) as {
      mode: string;
      posts: { id: string; authorName: string; flag: unknown }[];
    };
    expect(queue.mode).toBe('pre');
    const queued = queue.posts.find((p) => p.id === postId);
    expect(queued?.authorName).toBe('Amara');
    expect(queued?.flag).toBeNull();

    const approve = await callFunction('admin-share/moderate', {
      method: 'POST',
      bearer: superToken,
      body: { entityType: 'post', entityId: postId, action: 'approve' },
    });
    expect(approve.status).toBe(200);

    const peerFeed = await feedFor(peerToken);
    const visible = peerFeed.find((p) => p.id === postId);
    expect(visible?.status).toBe('approved');
    expect(visible?.authorName).toBe('Amara');
    expect(visible?.mine).toBe(false);
  });

  it('comments follow the same moderation path', async () => {
    const res = await callFunction('share/comment', {
      method: 'POST',
      bearer: peerToken,
      body: { postId, commentText: `${MARK} You deserve it, queen!` },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { comment: { id: string; status: string } };
    expect(body.comment.status).toBe('pending');
    commentId = body.comment.id;

    // The author of the post cannot see the pending comment; its writer can.
    const posterFeed = await feedFor(posterToken);
    expect(posterFeed.find((p) => p.id === postId)?.comments.some((c) => c.id === commentId)).toBe(
      false,
    );
    const peerFeed = await feedFor(peerToken);
    expect(
      peerFeed.find((p) => p.id === postId)?.comments.some((c) => c.id === commentId && c.mine),
    ).toBe(true);

    const approve = await callFunction('admin-share/moderate', {
      method: 'POST',
      bearer: superToken,
      body: { entityType: 'comment', entityId: commentId, action: 'approve' },
    });
    expect(approve.status).toBe(200);

    const posterAfter = await feedFor(posterToken);
    expect(posterAfter.find((p) => p.id === postId)?.comments.some((c) => c.id === commentId)).toBe(
      true,
    );
  });

  it('reactions toggle, stay in the approved set, and count per emoji', async () => {
    const on = await callFunction('share/react', {
      method: 'POST',
      bearer: peerToken,
      body: { postId, emoji: '👑' },
    });
    expect(on.status).toBe(200);
    expect(((await on.json()) as { reacted: boolean }).reacted).toBe(true);

    let feed = await feedFor(peerToken);
    let post = feed.find((p) => p.id === postId);
    expect(post?.reactions['👑']).toBe(1);
    expect(post?.myReactions).toContain('👑');

    const off = await callFunction('share/react', {
      method: 'POST',
      bearer: peerToken,
      body: { postId, emoji: '👑' },
    });
    expect(((await off.json()) as { reacted: boolean }).reacted).toBe(false);

    feed = await feedFor(peerToken);
    post = feed.find((p) => p.id === postId);
    expect(post?.reactions['👑']).toBeUndefined();

    const invalid = await callFunction('share/react', {
      method: 'POST',
      bearer: peerToken,
      body: { postId, emoji: '💀' },
    });
    expect(invalid.status).toBe(400);
  });

  it('a peer flag hides the post and surfaces it to admins with the flagger named', async () => {
    const flag = await callFunction('share/flag', {
      method: 'POST',
      bearer: peerToken,
      body: { entityType: 'post', entityId: postId },
    });
    expect(flag.status).toBe(200);

    // Hidden from peers again; the author sees it back in review.
    const peerFeed = await feedFor(peerToken);
    expect(peerFeed.some((p) => p.id === postId)).toBe(false);
    const posterFeed = await feedFor(posterToken);
    expect(posterFeed.find((p) => p.id === postId)?.status).toBe('pending');

    // A second flag does not stack another open row.
    await callFunction('share/flag', {
      method: 'POST',
      bearer: posterToken,
      body: { entityType: 'post', entityId: postId },
    });
    const flagRows = await restSelect(
      'flags',
      `entity_id=eq.${postId}&entity_type=eq.share_post&source=eq.peer&status=neq.resolved&select=id,flagged_by,severity`,
    );
    expect(flagRows).toHaveLength(1);
    expect(flagRows[0]?.flagged_by).toBe(peerId);
    expect(flagRows[0]?.severity).toBe('medium');

    const queueRes = await callFunction('admin-share?page=1', {
      method: 'GET',
      bearer: superToken,
    });
    const queue = (await queueRes.json()) as {
      posts: { id: string; flag: { flaggedBy: string } | null }[];
    };
    expect(queue.posts.find((p) => p.id === postId)?.flag?.flaggedBy).toBe('Bree');
  });

  it('removal resolves the flags with the note and hides the post for good', async () => {
    const remove = await callFunction('admin-share/moderate', {
      method: 'POST',
      bearer: superToken,
      body: {
        entityType: 'post',
        entityId: postId,
        action: 'remove',
        note: 'Talked with Amara privately.',
      },
    });
    expect(remove.status).toBe(200);

    const posterFeed = await feedFor(posterToken);
    expect(posterFeed.some((p) => p.id === postId)).toBe(false);

    const flagRows = await restSelect(
      'flags',
      `entity_id=eq.${postId}&entity_type=eq.share_post&source=eq.peer&select=status,admin_notes,reviewed_by`,
    );
    expect(flagRows.length).toBeGreaterThan(0);
    expect(flagRows.every((f) => f.status === 'resolved')).toBe(true);
    expect(flagRows[0]?.admin_notes).toBe('Talked with Amara privately.');
    expect(flagRows[0]?.reviewed_by).not.toBeNull();
  });

  it('post-approval mode publishes immediately until switched back', async () => {
    await setMode('post');

    const res = await callFunction('share/post', {
      method: 'POST',
      bearer: posterToken,
      body: { contentText: `${MARK} Post-mode celebration!`, turnstileToken: TURNSTILE_TOKEN },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { post: { id: string; status: string } };
    expect(body.post.status).toBe('approved');

    const peerFeed = await feedFor(peerToken);
    expect(peerFeed.some((p) => p.id === body.post.id && p.status === 'approved')).toBe(true);

    await setMode('pre');
    const setting = await restSelect('app_settings', 'key=eq.share_moderation_mode&select=value');
    expect(setting[0]?.value).toBe('pre');
  });

  it('carries a photo end-to-end: upload → review → approval → signed bytes', async () => {
    const res = await postMultipart(posterToken, {
      contentText: `${MARK} Look at my crown!`,
      photo: { bytes: TINY_PNG, name: 'crown.png', type: 'image/png' },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { post: { id: string; status: string } };
    expect(body.post.status).toBe('pending');
    const photoPostId = body.post.id;

    // The row records the type and the private storage path convention.
    const rows = await restSelect('share_posts', `id=eq.${photoPostId}&select=post_type,image_url`);
    expect(rows[0]?.post_type).toBe('photo_text');
    expect(rows[0]?.image_url).toBe(`${posterId}/${photoPostId}.png`);

    // The author sees her pending photo through a signed URL serving the
    // exact bytes she uploaded.
    const posterFeed = await feedFor(posterToken);
    const mine = posterFeed.find((p) => p.id === photoPostId);
    expect(mine?.imageUrl).not.toBeNull();
    const img = await fetch(toLocalUrl(String(mine?.imageUrl)));
    expect(img.status).toBe(200);
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(TINY_PNG);

    // Invisible to peers while pending; visible in the admin queue WITH the
    // photo the reviewer must judge.
    const peerFeed = await feedFor(peerToken);
    expect(peerFeed.some((p) => p.id === photoPostId)).toBe(false);
    const queueRes = await callFunction('admin-share?page=1', {
      method: 'GET',
      bearer: superToken,
    });
    const queue = (await queueRes.json()) as { posts: { id: string; imageUrl: string | null }[] };
    expect(queue.posts.find((p) => p.id === photoPostId)?.imageUrl).not.toBeNull();

    // Approval publishes it, signed URL intact.
    const approve = await callFunction('admin-share/moderate', {
      method: 'POST',
      bearer: superToken,
      body: { entityType: 'post', entityId: photoPostId, action: 'approve' },
    });
    expect(approve.status).toBe(200);
    const peerAfter = await feedFor(peerToken);
    expect(peerAfter.find((p) => p.id === photoPostId)?.imageUrl).not.toBeNull();

    // The bucket stays private: no signature, no bytes — with the anon key
    // or with none at all.
    const path = `${posterId}/${photoPostId}.png`;
    const direct = await fetch(`${API_URL}/storage/v1/object/share-media/${path}`, {
      headers: { apikey: anonKey(), Authorization: `Bearer ${anonKey()}` },
    });
    expect(direct.status).not.toBe(200);
    const publicUrl = await fetch(`${API_URL}/storage/v1/object/public/share-media/${path}`);
    expect(publicUrl.status).not.toBe(200);
  });

  it('accepts a photo-only post and types it correctly', async () => {
    const res = await postMultipart(posterToken, {
      photo: { bytes: TINY_PNG, name: 'just-a-photo.png', type: 'image/png' },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { post: { id: string } };
    const rows = await restSelect(
      'share_posts',
      `id=eq.${body.post.id}&select=post_type,content_text`,
    );
    expect(rows[0]?.post_type).toBe('photo');
    expect(rows[0]?.content_text).toBeNull();

    // Photo-only posts still ride the feed (null text, working image).
    const feed = await rawFeedFor(posterToken);
    expect(feed.find((p) => p.id === body.post.id)?.imageUrl).not.toBeNull();
  });

  it('rejects impostor bytes and oversize files by content, not by name', async () => {
    // HTML dressed as a PNG — magic bytes expose it.
    const impostor = await postMultipart(posterToken, {
      photo: {
        bytes: new TextEncoder().encode('<html>not a picture</html>'),
        name: 'innocent.png',
        type: 'image/png',
      },
    });
    expect(impostor.status).toBe(400);
    expect(((await impostor.json()) as { error: string }).error).toBe('unsupported_image');

    // One byte over the cap, real JPEG magic — size check catches it.
    const oversize = new Uint8Array(5 * 1024 * 1024 + 1);
    oversize[0] = 0xff;
    oversize[1] = 0xd8;
    oversize[2] = 0xff;
    const tooBig = await postMultipart(posterToken, {
      photo: { bytes: oversize, name: 'huge.jpg', type: 'image/jpeg' },
    });
    expect(tooBig.status).toBe(400);
  });

  it('enforces the boundaries: roles, bad targets, malformed posts', async () => {
    // Admin tokens have no student surface; students have no admin surface.
    const adminOnShare = await callFunction('share?page=1', { method: 'GET', bearer: superToken });
    expect(adminOnShare.status).toBe(403);
    const studentOnAdmin = await callFunction('admin-share?page=1', {
      method: 'GET',
      bearer: posterToken,
    });
    expect(studentOnAdmin.status).toBe(403);
    const mentorOnAdmin = await callFunction('admin-share?page=1', {
      method: 'GET',
      bearer: mentorToken,
    });
    expect(mentorOnAdmin.status).toBe(403);
    const anon = await callFunction('share?page=1', { method: 'GET' });
    expect(anon.status).toBe(401);

    // A post without its Turnstile token never reaches the table.
    const noTurnstile = await callFunction('share/post', {
      method: 'POST',
      bearer: posterToken,
      body: { contentText: `${MARK} sneaky` },
    });
    expect(noTurnstile.status).toBe(400);

    // Commenting on a non-approved post is a 404, not a leak.
    const ghost = await callFunction('share/comment', {
      method: 'POST',
      bearer: peerToken,
      body: { postId: '00000000-0000-0000-0000-000000000000', commentText: 'hello?' },
    });
    expect(ghost.status).toBe(404);

    // Moderating a nonexistent entity is a 404.
    const ghostModerate = await callFunction('admin-share/moderate', {
      method: 'POST',
      bearer: superToken,
      body: {
        entityType: 'post',
        entityId: '00000000-0000-0000-0000-000000000000',
        action: 'approve',
      },
    });
    expect(ghostModerate.status).toBe(404);
  });
});
