/**
 * admin-requests — the staff queue behind the SXU "Your people" cards:
 * 1:1 session asks waiting for a real time, and friend invites waiting for
 * human outreach. The human IS the send button here — the app never
 * contacts an invitee itself, and confirming a session is what puts it on
 * the student's card.
 *
 *   GET  /admin-requests                    { sessions, invites }
 *   POST /admin-requests/sessions/confirm   { requestId, date, time, endTime }
 *   POST /admin-requests/sessions/decline   { requestId }
 *   POST /admin-requests/invites/reached-out { inviteId }
 *   POST /admin-requests/invites/decline    { inviteId }
 *
 * super_admin only until OD-12 assigns queue rights. Deciding an invite
 * scrubs the address (data minimization) — only the hash remains.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { z } from 'npm:zod@4';
import { createServiceClient } from '../_shared/db.ts';
import { errorResponse, handlePreflight, jsonResponse } from '../_shared/http.ts';
import { requireAdmin, type AdminContext } from '../_shared/adminAuth.ts';
import { writeAudit } from '../_shared/audit.ts';
import { serverLog } from '../_shared/logger.ts';

const SESSION_ENTITY = 'mentor_session_request';
const INVITE_ENTITY = 'friend_invite';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()), 'not a real date');
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const confirmSchema = z
  .object({
    requestId: z.uuid(),
    date: isoDate,
    time: timeOfDay,
    endTime: timeOfDay.nullable(),
  })
  .strict()
  .refine((v) => v.endTime === null || v.endTime > v.time, {
    message: 'endTime must be after time',
  });

const sessionIdSchema = z.object({ requestId: z.uuid() }).strict();
const inviteIdSchema = z.object({ inviteId: z.uuid() }).strict();

type SessionRow = {
  id: string;
  status: string;
  preferred_windows: unknown;
  scheduled_date: string | null;
  scheduled_time: string | null;
  end_time: string | null;
  created_at: string;
  students: { display_name: string };
};

type InviteRow = {
  id: string;
  invite_email: string | null;
  created_at: string;
  students: { display_name: string };
};

const SESSION_COLUMNS =
  'id, status, preferred_windows, scheduled_date, scheduled_time, end_time, created_at, students!inner(display_name)';

function sessionToWire(row: SessionRow) {
  return {
    id: String(row.id),
    studentName: String(row.students.display_name),
    status: row.status,
    preferredWindows: row.preferred_windows,
    scheduledDate: row.scheduled_date,
    scheduledTime: row.scheduled_time === null ? null : row.scheduled_time.slice(0, 5),
    endTime: row.end_time === null ? null : row.end_time.slice(0, 5),
    createdAt: row.created_at,
  };
}

async function handleList(db: SupabaseClient, req: Request, ctx: AdminContext): Promise<Response> {
  const today = new Date().toISOString().slice(0, 10);
  const [sessionsRes, invitesRes] = await Promise.all([
    // The queue plus the near future: pending asks to act on, and confirmed
    // upcoming sessions so the schedule staff built stays visible.
    db
      .from('mentor_session_requests')
      .select(SESSION_COLUMNS)
      .or(`status.eq.pending,and(status.eq.confirmed,scheduled_date.gte.${today})`)
      .order('created_at', { ascending: true }),
    db
      .from('friend_invites')
      .select('id, invite_email, created_at, students!inner(display_name)')
      .eq('status', 'pending')
      .order('created_at', { ascending: true }),
  ]);
  if (sessionsRes.error !== null || invitesRes.error !== null) {
    serverLog.error('admin_requests.list_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  await writeAudit(db, {
    actorType: 'admin',
    actorId: ctx.subject.subjectId,
    actorRole: ctx.role,
    action: 'read',
    entityType: SESSION_ENTITY,
    entityId: null,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: {
      sessions: sessionsRes.data.length,
      invites: invitesRes.data.length,
    },
  });

  return jsonResponse(req, 200, {
    sessions: (sessionsRes.data as unknown as SessionRow[]).map(sessionToWire),
    invites: (invitesRes.data as unknown as InviteRow[]).map((row) => ({
      id: String(row.id),
      studentName: String(row.students.display_name),
      email: row.invite_email,
      createdAt: row.created_at,
    })),
  });
}

async function handleConfirmSession(
  db: SupabaseClient,
  req: Request,
  ctx: AdminContext,
  body: unknown,
): Promise<Response> {
  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }

  const { data, error } = await db
    .from('mentor_session_requests')
    .update({
      status: 'confirmed',
      scheduled_date: parsed.data.date,
      scheduled_time: parsed.data.time,
      end_time: parsed.data.endTime,
      confirmed_by: ctx.subject.subjectId,
      decided_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.requestId)
    .eq('status', 'pending')
    .select(SESSION_COLUMNS)
    .maybeSingle();
  if (error !== null) {
    serverLog.error('admin_requests.confirm_failed', {});
    return errorResponse(req, 500, 'server_error');
  }
  if (data === null) {
    // Unknown id or already decided — either way, nothing to confirm.
    return errorResponse(req, 404, 'not_found');
  }

  await writeAudit(db, {
    actorType: 'admin',
    actorId: ctx.subject.subjectId,
    actorRole: ctx.role,
    action: 'update',
    entityType: SESSION_ENTITY,
    entityId: parsed.data.requestId,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { decision: 'confirmed' },
  });

  return jsonResponse(req, 200, { session: sessionToWire(data as unknown as SessionRow) });
}

async function handleDeclineSession(
  db: SupabaseClient,
  req: Request,
  ctx: AdminContext,
  body: unknown,
): Promise<Response> {
  const parsed = sessionIdSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }

  const { data, error } = await db
    .from('mentor_session_requests')
    .update({ status: 'declined', decided_at: new Date().toISOString() })
    .eq('id', parsed.data.requestId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (error !== null) {
    serverLog.error('admin_requests.decline_failed', {});
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
    entityType: SESSION_ENTITY,
    entityId: parsed.data.requestId,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { decision: 'declined' },
  });

  return jsonResponse(req, 200, { declined: true });
}

async function decideInvite(
  db: SupabaseClient,
  req: Request,
  ctx: AdminContext,
  body: unknown,
  decision: 'reached_out' | 'declined',
): Promise<Response> {
  const parsed = inviteIdSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }

  // Deciding scrubs the address — the hash alone carries the dedupe.
  const { data, error } = await db
    .from('friend_invites')
    .update({
      status: decision,
      invite_email: null,
      decided_by: ctx.subject.subjectId,
      decided_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.inviteId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (error !== null) {
    serverLog.error('admin_requests.invite_decide_failed', {});
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
    entityType: INVITE_ENTITY,
    entityId: parsed.data.inviteId,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { decision },
  });

  return jsonResponse(req, 200, { decided: true });
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
  const parent = segments.at(-2);

  const db = createServiceClient();
  const auth = await requireAdmin(db, req, SESSION_ENTITY, ['super_admin']);
  if (!auth.ok) {
    return auth.response;
  }

  if (req.method === 'GET') {
    return action === 'admin-requests'
      ? handleList(db, req, auth.ctx)
      : errorResponse(req, 404, 'not_found');
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, 400, 'invalid_request');
  }

  if (parent === 'sessions' && action === 'confirm') {
    return handleConfirmSession(db, req, auth.ctx, body);
  }
  if (parent === 'sessions' && action === 'decline') {
    return handleDeclineSession(db, req, auth.ctx, body);
  }
  if (parent === 'invites' && action === 'reached-out') {
    return decideInvite(db, req, auth.ctx, body, 'reached_out');
  }
  if (parent === 'invites' && action === 'decline') {
    return decideInvite(db, req, auth.ctx, body, 'declined');
  }
  return errorResponse(req, 404, 'not_found');
});
