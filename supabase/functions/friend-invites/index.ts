/**
 * friend-invites — the student's side of "Invite a friend" (SXU "Your
 * people"). She nominates a friend's email; the invite lands in the staff
 * queue (admin-requests) and a human does the outreach — the app never
 * emails the invitee, and the address is scrubbed once staff decide.
 *
 *   GET  /friend-invites          her recent invites, newest first
 *   POST /friend-invites/create   { email }
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { z } from 'npm:zod@4';
import { createServiceClient } from '../_shared/db.ts';
import { errorResponse, handlePreflight, jsonResponse } from '../_shared/http.ts';
import { requireStudent, type StudentContext } from '../_shared/studentAuth.ts';
import { enforceFriendInviteRateLimit } from '../_shared/rateLimit.ts';
import { writeAudit } from '../_shared/audit.ts';
import { serverLog } from '../_shared/logger.ts';

const ENTITY = 'friend_invite';
const LIST_LIMIT = 10;
/** Open nominations at once — the queue is a human's plate, not a funnel. */
const PENDING_LIMIT = 3;

const createSchema = z
  .object({ email: z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(254)) })
  .strict();

/** sha256 hex of the normalized address — the dedupe key that outlives it. */
async function emailHash(normalized: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

type InviteRow = {
  id: string;
  invite_email: string | null;
  status: string;
  created_at: string;
};

function toWire(row: InviteRow) {
  return {
    id: String(row.id),
    // Present only while pending — decided rows are scrubbed by design.
    email: row.invite_email,
    status: row.status,
    createdAt: row.created_at,
  };
}

async function handleGet(db: SupabaseClient, req: Request, ctx: StudentContext): Promise<Response> {
  const { data, error } = await db
    .from('friend_invites')
    .select('id, invite_email, status, created_at')
    .eq('student_id', ctx.subject.subjectId)
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT);
  if (error !== null) {
    serverLog.error('friend_invites.list_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  await writeAudit(db, {
    actorType: 'student',
    actorId: ctx.subject.subjectId,
    actorRole: 'student',
    action: 'read',
    entityType: ENTITY,
    entityId: null,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { returned: data.length },
  });

  return jsonResponse(req, 200, { invites: (data as InviteRow[]).map(toWire) });
}

async function handleCreate(
  db: SupabaseClient,
  req: Request,
  ctx: StudentContext,
  body: unknown,
): Promise<Response> {
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }
  const email = parsed.data.email;

  const rate = await enforceFriendInviteRateLimit(db, ctx.subject.subjectId);
  if (!rate.allowed) {
    return errorResponse(req, 429, 'rate_limited', {
      'Retry-After': String(rate.retryAfterSeconds),
    });
  }

  const hash = await emailHash(email);
  const self = ctx.subject.subjectId;

  // Same inbox never targeted twice, and only a few nominations in the
  // queue at once. The partial unique index backstops the dedupe for races.
  const [dupRes, pendingRes] = await Promise.all([
    db
      .from('friend_invites')
      .select('id', { count: 'exact', head: true })
      .eq('student_id', self)
      .eq('email_hash', hash)
      .in('status', ['pending', 'reached_out']),
    db
      .from('friend_invites')
      .select('id', { count: 'exact', head: true })
      .eq('student_id', self)
      .eq('status', 'pending'),
  ]);
  if (
    dupRes.error !== null ||
    dupRes.count === null ||
    pendingRes.error !== null ||
    pendingRes.count === null
  ) {
    serverLog.error('friend_invites.precheck_failed', {});
    return errorResponse(req, 500, 'server_error');
  }
  if (dupRes.count > 0) {
    return errorResponse(req, 409, 'already_invited');
  }
  if (pendingRes.count >= PENDING_LIMIT) {
    return errorResponse(req, 409, 'invite_limit');
  }

  const { data, error } = await db
    .from('friend_invites')
    .insert({ student_id: self, invite_email: email, email_hash: hash })
    .select('id')
    .single();
  if (error !== null) {
    if (error.code === '23505') {
      return errorResponse(req, 409, 'already_invited');
    }
    serverLog.error('friend_invites.insert_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  // Ids only — the address itself never lands in a log (CLAUDE.md §6).
  await writeAudit(db, {
    actorType: 'student',
    actorId: self,
    actorRole: 'student',
    action: 'create',
    entityType: ENTITY,
    entityId: String(data.id),
    outcome: 'allowed',
    ip: ctx.ip,
  });

  return jsonResponse(req, 201, { inviteId: String(data.id) });
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
  const auth = await requireStudent(db, req, ENTITY);
  if (!auth.ok) {
    return auth.response;
  }

  if (req.method === 'GET') {
    return action === 'friend-invites'
      ? handleGet(db, req, auth.ctx)
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
  return errorResponse(req, 404, 'not_found');
});
