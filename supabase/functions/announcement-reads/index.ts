/**
 * announcement-reads — the student's read receipts (Phase 9, Spec §6.7
 * "track who's seen it"). POST marks the given announcements read for the
 * signed-in student; idempotent (re-marking is a no-op, the first read_at
 * stands). The student id comes from her session, never from the body —
 * receipts reference minors, which is why this write crosses an Edge
 * Function instead of the Data API.
 */
import { z } from 'npm:zod@4';
import { createServiceClient } from '../_shared/db.ts';
import { errorResponse, handlePreflight, jsonResponse } from '../_shared/http.ts';
import { requireStudent } from '../_shared/studentAuth.ts';
import { writeAudit } from '../_shared/audit.ts';
import { serverLog } from '../_shared/logger.ts';

const ENTITY = 'announcement_read';

const bodySchema = z
  .object({ announcementIds: z.array(z.uuid()).min(1).max(50) })
  .strict();

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight !== null) {
    return preflight;
  }
  if (req.method !== 'POST') {
    return errorResponse(req, 405, 'method_not_allowed');
  }

  const db = createServiceClient();
  const auth = await requireStudent(db, req, ENTITY);
  if (!auth.ok) {
    return auth.response;
  }
  const { ctx } = auth;

  let raw: unknown = null;
  try {
    raw = await req.json();
  } catch {
    return errorResponse(req, 400, 'invalid_request');
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }

  // Only ids that actually exist — an unknown id must not fail the batch
  // (the feed and the receipts can race an admin delete) nor hit the FK.
  const { data: existing, error: existsError } = await db
    .from('announcements')
    .select('id')
    .in('id', parsed.data.announcementIds);
  if (existsError !== null) {
    serverLog.error('announcement_reads.lookup_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  const rows = existing.map((a) => ({
    announcement_id: String(a.id),
    student_id: ctx.subject.subjectId,
  }));
  if (rows.length > 0) {
    const { error } = await db
      .from('announcement_reads')
      .upsert(rows, { onConflict: 'announcement_id,student_id', ignoreDuplicates: true });
    if (error !== null) {
      serverLog.error('announcement_reads.upsert_failed', {});
      return errorResponse(req, 500, 'server_error');
    }
  }

  await writeAudit(db, {
    actorType: 'student',
    actorId: ctx.subject.subjectId,
    actorRole: 'student',
    action: 'create',
    entityType: ENTITY,
    entityId: null,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { requested: parsed.data.announcementIds.length, marked: rows.length },
  });

  return jsonResponse(req, 200, { marked: rows.length });
});
