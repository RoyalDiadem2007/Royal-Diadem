/**
 * admin-calendar — calendar event CRUD for the admin panel (Phase 9, Spec
 * §6.6 / §6.10 "Calendar": add/edit events).
 *   GET  /admin-calendar?page=&from=   events from `from` (default today) on,
 *                                      ascending, paginated
 *   POST /admin-calendar/create        new event
 *   POST /admin-calendar/update        edit an event
 *   POST /admin-calendar/delete        remove an event
 *
 * super_admin only until OD-12 assigns calendar rights. Recurrence is the
 * documented weekly subset (FREQ=WEEKLY, optional UNTIL) — the only rule the
 * admin UI can author and the student view can expand; nothing else is
 * accepted, so no rule in the table can be one the client cannot render.
 * Visibility is always 'all': no group model exists yet (the enum's
 * 'specific_group' value waits for it), and the anon RLS policy hides
 * anything else from students.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { z } from 'npm:zod@4';
import { createServiceClient } from '../_shared/db.ts';
import { errorResponse, handlePreflight, jsonResponse } from '../_shared/http.ts';
import { requireAdmin, type AdminContext } from '../_shared/adminAuth.ts';
import { writeAudit } from '../_shared/audit.ts';
import { serverLog } from '../_shared/logger.ts';

const ENTITY = 'calendar_event';
const PAGE_SIZE = 50;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  (value) => !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()),
  'not a real date',
);
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const eventFieldsSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).nullable(),
    eventDate: isoDate,
    eventTime: timeOfDay.nullable(),
    endTime: timeOfDay.nullable(),
    repeatsWeekly: z.boolean(),
    repeatUntil: isoDate.nullable(),
  })
  .strict()
  .refine((v) => v.eventTime !== null || v.endTime === null, {
    message: 'endTime requires eventTime',
  })
  .refine((v) => v.eventTime === null || v.endTime === null || v.endTime > v.eventTime, {
    message: 'endTime must be after eventTime',
  })
  .refine((v) => v.repeatsWeekly || v.repeatUntil === null, {
    message: 'repeatUntil requires repeatsWeekly',
  })
  .refine((v) => v.repeatUntil === null || v.repeatUntil >= v.eventDate, {
    message: 'repeatUntil must not precede eventDate',
  });

type EventFields = z.infer<typeof eventFieldsSchema>;

/** The weekly-subset RRULE this app writes; UNTIL is date-only (schedule dates). */
function ruleFor(fields: EventFields): string | null {
  if (!fields.repeatsWeekly) {
    return null;
  }
  return fields.repeatUntil === null
    ? 'FREQ=WEEKLY'
    : `FREQ=WEEKLY;UNTIL=${fields.repeatUntil.replaceAll('-', '')}`;
}

function rowFor(fields: EventFields): Record<string, unknown> {
  return {
    title: fields.title,
    description: fields.description,
    event_date: fields.eventDate,
    event_time: fields.eventTime,
    end_time: fields.endTime,
    is_recurring: fields.repeatsWeekly,
    recurrence_rule: ruleFor(fields),
    visibility: 'all',
  };
}

type EventRow = {
  id: string;
  title: string;
  description: string | null;
  event_date: string;
  event_time: string | null;
  end_time: string | null;
  is_recurring: boolean;
  recurrence_rule: string | null;
};

/** Postgres `time` comes back HH:MM:SS; the wire format is HH:MM. */
function toWire(row: EventRow) {
  return {
    id: String(row.id),
    title: row.title,
    description: row.description,
    eventDate: row.event_date,
    eventTime: row.event_time === null ? null : row.event_time.slice(0, 5),
    endTime: row.end_time === null ? null : row.end_time.slice(0, 5),
    repeatsWeekly: row.is_recurring,
    recurrenceRule: row.recurrence_rule,
  };
}

const EVENT_COLUMNS =
  'id, title, description, event_date, event_time, end_time, is_recurring, recurrence_rule';

async function handleList(db: SupabaseClient, req: Request, ctx: AdminContext): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const pageParam = params.get('page') ?? '1';
  const page = /^\d{1,6}$/.test(pageParam) ? Math.max(1, Number(pageParam)) : 1;
  const fromParam = params.get('from');
  const fromParsed = isoDate.safeParse(fromParam ?? new Date().toISOString().slice(0, 10));
  if (!fromParsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }
  const from = (page - 1) * PAGE_SIZE;

  const { data, error, count } = await db
    .from('calendar_events')
    .select(EVENT_COLUMNS, { count: 'exact' })
    .or(`event_date.gte.${fromParsed.data},and(is_recurring.eq.true,recurrence_rule.not.is.null)`)
    .order('event_date', { ascending: true })
    .order('event_time', { ascending: true, nullsFirst: true })
    .range(from, from + PAGE_SIZE - 1);
  if (error !== null || count === null) {
    serverLog.error('admin_calendar.list_failed', {});
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
    events: (data as EventRow[]).map(toWire),
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
  const parsed = eventFieldsSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }

  const { data, error } = await db
    .from('calendar_events')
    .insert({ ...rowFor(parsed.data), created_by: ctx.subject.subjectId })
    .select(EVENT_COLUMNS)
    .single();
  if (error !== null) {
    serverLog.error('admin_calendar.create_failed', {});
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

  return jsonResponse(req, 201, { event: toWire(data as EventRow) });
}

const deleteSchema = z.object({ eventId: z.uuid() }).strict();

async function handleUpdate(
  db: SupabaseClient,
  req: Request,
  ctx: AdminContext,
  body: unknown,
): Promise<Response> {
  if (typeof body !== 'object' || body === null) {
    return errorResponse(req, 400, 'invalid_request');
  }
  const { eventId, ...fields } = body as Record<string, unknown>;
  const idParsed = z.uuid().safeParse(eventId);
  const parsed = eventFieldsSchema.safeParse(fields);
  if (!idParsed.success || !parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }

  const { data, error } = await db
    .from('calendar_events')
    .update(rowFor(parsed.data))
    .eq('id', idParsed.data)
    .select(EVENT_COLUMNS)
    .maybeSingle();
  if (error !== null) {
    serverLog.error('admin_calendar.update_failed', {});
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
    entityId: idParsed.data,
    outcome: 'allowed',
    ip: ctx.ip,
  });

  return jsonResponse(req, 200, { event: toWire(data as EventRow) });
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

  const { data, error } = await db
    .from('calendar_events')
    .delete()
    .eq('id', parsed.data.eventId)
    .select('id')
    .maybeSingle();
  if (error !== null) {
    serverLog.error('admin_calendar.delete_failed', {});
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
    entityId: parsed.data.eventId,
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
    return action === 'admin-calendar'
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
  if (action === 'update') {
    return handleUpdate(db, req, auth.ctx, body);
  }
  if (action === 'delete') {
    return handleDelete(db, req, auth.ctx, body);
  }
  return errorResponse(req, 404, 'not_found');
});
