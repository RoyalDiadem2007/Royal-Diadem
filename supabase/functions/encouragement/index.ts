/**
 * encouragement — the Encouragement Engine (Phase 7, Spec §6.5/§10) on the
 * OD-18 governed AI gateway.
 *
 *   POST /encouragement/generate      generate the week's 7 drafts (Haiku via
 *                                     the locked gate; replaces prior drafts)
 *   GET  /encouragement?weekOf=       the week's messages, every status
 *   POST /encouragement/approve       draft → approved
 *   POST /encouragement/reject        → rejected + ai_corrections row
 *   POST /encouragement/replace       AI draft → rejected + correction; her
 *                                     own words inserted approved
 *   POST /encouragement/post          approved rows for the week → posted
 *   GET/POST /encouragement/rules(+/toggle)   human-approved gateway rules
 *
 * NO AUTO-PASS (OD-18/CLAUDE.md §1): nothing generated here reaches a student
 * until a human approves AND posts it — the anon read policy on
 * encouragement_messages only exposes status='posted'. super_admin only.
 * §17.4: zero student data enters any prompt.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { createServiceClient } from '../_shared/db.ts';
import { errorResponse, handlePreflight, jsonResponse } from '../_shared/http.ts';
import { requireAdmin, type AdminContext } from '../_shared/adminAuth.ts';
import { writeAudit } from '../_shared/audit.ts';
import { serverLog } from '../_shared/logger.ts';
import { enforceAiGenerationRateLimit } from '../_shared/rateLimit.ts';
import {
  aiConfigured,
  generateEncouragementBatch,
  MESSAGES_PER_WEEK,
} from '../_shared/aiGateway.ts';
import {
  approveMessageSchema,
  createAiRuleSchema,
  generateWeekSchema,
  parseJsonBody,
  postWeekSchema,
  rejectMessageSchema,
  replaceMessageSchema,
  toggleAiRuleSchema,
} from '../_shared/validate.ts';

const ENTITY = 'encouragement_message';

type MessageRow = {
  id: string;
  message_text: string;
  source: string;
  ai_generation_metadata: Record<string, unknown> | null;
  scheduled_date: string;
  week_of: string;
  status: string;
};

const COLUMNS = 'id, message_text, source, ai_generation_metadata, scheduled_date, week_of, status';

function toWire(row: MessageRow) {
  const metadata = row.ai_generation_metadata;
  return {
    id: row.id,
    text: row.message_text,
    source: row.source,
    scheduledDate: row.scheduled_date,
    weekOf: row.week_of,
    status: row.status,
    model: metadata === null ? null : String(metadata.model ?? ''),
  };
}

function isMonday(isoDate: string): boolean {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.getUTCDay() === 1;
}

function dateOffset(isoDate: string, days: number): string {
  const base = new Date(`${isoDate}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

async function activeRules(db: SupabaseClient): Promise<string[] | null> {
  const { data, error } = await db
    .from('ai_rules')
    .select('rule_text')
    .eq('active', true)
    .order('created_at', { ascending: true });
  if (error !== null) {
    serverLog.error('encouragement.rules_failed', {});
    return null;
  }
  return data.map((row) => String(row.rule_text));
}

async function handleGenerate(
  db: SupabaseClient,
  req: Request,
  ctx: AdminContext,
): Promise<Response> {
  const parsed = generateWeekSchema.safeParse(await parseJsonBody(req));
  if (!parsed.success || !isMonday(parsed.data.weekOf)) {
    return errorResponse(req, 400, 'invalid_request');
  }
  const { weekOf } = parsed.data;

  if (!aiConfigured()) {
    return errorResponse(req, 503, 'ai_not_configured');
  }
  const limit = await enforceAiGenerationRateLimit(db);
  if (!limit.allowed) {
    return errorResponse(req, 429, 'too_many_attempts', {
      'Retry-After': String(limit.retryAfterSeconds),
    });
  }

  const rules = await activeRules(db);
  if (rules === null) {
    return errorResponse(req, 500, 'server_error');
  }

  const result = await generateEncouragementBatch(rules);
  if (!result.ok) {
    serverLog.error('encouragement.generation_failed', { failure: result.reason });
    return errorResponse(req, result.reason === 'not_configured' ? 503 : 502, 'generation_failed');
  }

  // Regeneration replaces only unreviewed drafts — approved/posted/rejected
  // rows are history and stay untouched.
  const { error: clearError } = await db
    .from('encouragement_messages')
    .update({ status: 'rejected' })
    .eq('week_of', weekOf)
    .eq('status', 'draft');
  if (clearError !== null) {
    serverLog.error('encouragement.clear_drafts_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  const rows = result.messages.map((text, index) => ({
    message_text: text,
    source: 'ai_generated',
    ai_generation_metadata: { ...result.metadata, generatedAt: new Date().toISOString() },
    scheduled_date: dateOffset(weekOf, index),
    week_of: weekOf,
    status: 'draft',
  }));
  const { data: inserted, error } = await db
    .from('encouragement_messages')
    .insert(rows)
    .select(COLUMNS);
  if (error !== null) {
    serverLog.error('encouragement.insert_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  await writeAudit(db, {
    actorType: 'admin',
    actorId: ctx.subject.subjectId,
    actorRole: ctx.role,
    action: 'create',
    entityType: ENTITY,
    entityId: null,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { operation: 'generate', weekOf, count: MESSAGES_PER_WEEK },
  });

  return jsonResponse(req, 201, { messages: (inserted as MessageRow[]).map(toWire) });
}

async function handleList(db: SupabaseClient, req: Request, ctx: AdminContext): Promise<Response> {
  const weekOf = new URL(req.url).searchParams.get('weekOf') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekOf) || !isMonday(weekOf)) {
    return errorResponse(req, 400, 'invalid_request');
  }
  const { data, error } = await db
    .from('encouragement_messages')
    .select(COLUMNS)
    .eq('week_of', weekOf)
    .order('scheduled_date', { ascending: true })
    .order('created_at', { ascending: true });
  if (error !== null) {
    serverLog.error('encouragement.list_failed', {});
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
    metadata: { weekOf, returned: data.length },
  });

  return jsonResponse(req, 200, { messages: (data as MessageRow[]).map(toWire) });
}

async function loadMessage(db: SupabaseClient, id: string): Promise<MessageRow | null | 'error'> {
  const { data, error } = await db
    .from('encouragement_messages')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error !== null) {
    serverLog.error('encouragement.load_failed', {});
    return 'error';
  }
  return data as MessageRow | null;
}

async function setStatus(
  db: SupabaseClient,
  id: string,
  from: readonly string[],
  to: string,
  extra: Record<string, unknown> = {},
): Promise<boolean | null> {
  const { data, error } = await db
    .from('encouragement_messages')
    .update({ status: to, ...extra })
    .eq('id', id)
    .in('status', [...from])
    .select('id');
  if (error !== null) {
    serverLog.error('encouragement.status_failed', {});
    return null;
  }
  return data.length > 0;
}

async function recordCorrection(
  db: SupabaseClient,
  ctx: AdminContext,
  message: MessageRow,
  reason: string,
  correctedText: string | null,
  ruleId: string | null,
): Promise<boolean> {
  const metadata = message.ai_generation_metadata;
  const { error } = await db.from('ai_corrections').insert({
    message_id: message.id,
    original_text: message.message_text,
    corrected_text: correctedText,
    reason,
    rule_violated: ruleId,
    reviewed_by: ctx.subject.subjectId,
    model: metadata === null ? 'admin_written' : String(metadata.model ?? 'unknown'),
    prompt_version: metadata === null ? 'n/a' : String(metadata.promptVersion ?? 'unknown'),
  });
  if (error !== null) {
    serverLog.error('encouragement.correction_failed', {});
    return false;
  }
  return true;
}

async function handleApprove(
  db: SupabaseClient,
  req: Request,
  ctx: AdminContext,
): Promise<Response> {
  const parsed = approveMessageSchema.safeParse(await parseJsonBody(req));
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }
  const changed = await setStatus(db, parsed.data.messageId, ['draft'], 'approved');
  if (changed === null) {
    return errorResponse(req, 500, 'server_error');
  }
  if (!changed) {
    return errorResponse(req, 409, 'not_actionable');
  }

  await writeAudit(db, {
    actorType: 'admin',
    actorId: ctx.subject.subjectId,
    actorRole: ctx.role,
    action: 'update',
    entityType: ENTITY,
    entityId: parsed.data.messageId,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { operation: 'approve' },
  });
  return jsonResponse(req, 200, { status: 'approved' });
}

async function handleReject(
  db: SupabaseClient,
  req: Request,
  ctx: AdminContext,
): Promise<Response> {
  const parsed = rejectMessageSchema.safeParse(await parseJsonBody(req));
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }
  const { messageId, reason, ruleId } = parsed.data;

  const message = await loadMessage(db, messageId);
  if (message === 'error') {
    return errorResponse(req, 500, 'server_error');
  }
  if (message === null) {
    return errorResponse(req, 404, 'not_found');
  }

  const changed = await setStatus(db, messageId, ['draft', 'approved'], 'rejected');
  if (changed === null) {
    return errorResponse(req, 500, 'server_error');
  }
  if (!changed) {
    return errorResponse(req, 409, 'not_actionable');
  }
  if (!(await recordCorrection(db, ctx, message, reason, null, ruleId ?? null))) {
    return errorResponse(req, 500, 'server_error');
  }

  await writeAudit(db, {
    actorType: 'admin',
    actorId: ctx.subject.subjectId,
    actorRole: ctx.role,
    action: 'update',
    entityType: ENTITY,
    entityId: messageId,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { operation: 'reject' },
  });
  return jsonResponse(req, 200, { status: 'rejected' });
}

async function handleReplace(
  db: SupabaseClient,
  req: Request,
  ctx: AdminContext,
): Promise<Response> {
  const parsed = replaceMessageSchema.safeParse(await parseJsonBody(req));
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }
  const { messageId, text, reason } = parsed.data;

  const message = await loadMessage(db, messageId);
  if (message === 'error') {
    return errorResponse(req, 500, 'server_error');
  }
  if (message === null) {
    return errorResponse(req, 404, 'not_found');
  }

  const changed = await setStatus(db, messageId, ['draft', 'approved'], 'rejected');
  if (changed === null) {
    return errorResponse(req, 500, 'server_error');
  }
  if (!changed) {
    return errorResponse(req, 409, 'not_actionable');
  }
  if (!(await recordCorrection(db, ctx, message, reason, text, null))) {
    return errorResponse(req, 500, 'server_error');
  }

  // Her words, pre-approved by authorship (Spec §6.5 step 5).
  const { data: inserted, error } = await db
    .from('encouragement_messages')
    .insert({
      message_text: text,
      source: 'admin_written',
      scheduled_date: message.scheduled_date,
      week_of: message.week_of,
      status: 'approved',
    })
    .select(COLUMNS)
    .maybeSingle();
  if (error !== null || inserted === null) {
    serverLog.error('encouragement.replace_insert_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  await writeAudit(db, {
    actorType: 'admin',
    actorId: ctx.subject.subjectId,
    actorRole: ctx.role,
    action: 'update',
    entityType: ENTITY,
    entityId: messageId,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { operation: 'replace', replacementId: String((inserted as MessageRow).id) },
  });
  return jsonResponse(req, 201, { message: toWire(inserted as MessageRow) });
}

async function handlePost(db: SupabaseClient, req: Request, ctx: AdminContext): Promise<Response> {
  const parsed = postWeekSchema.safeParse(await parseJsonBody(req));
  if (!parsed.success || !isMonday(parsed.data.weekOf)) {
    return errorResponse(req, 400, 'invalid_request');
  }
  const { weekOf } = parsed.data;

  const { data, error } = await db
    .from('encouragement_messages')
    .update({ status: 'posted', posted_at: new Date().toISOString(), posted_by: ctx.subject.subjectId })
    .eq('week_of', weekOf)
    .eq('status', 'approved')
    .select('id');
  if (error !== null) {
    serverLog.error('encouragement.post_failed', {});
    return errorResponse(req, 500, 'server_error');
  }
  if (data.length === 0) {
    return errorResponse(req, 409, 'nothing_approved');
  }

  await writeAudit(db, {
    actorType: 'admin',
    actorId: ctx.subject.subjectId,
    actorRole: ctx.role,
    action: 'update',
    entityType: ENTITY,
    entityId: null,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { operation: 'post', weekOf, posted: data.length },
  });
  return jsonResponse(req, 200, { posted: data.length });
}

async function handleRuleList(
  db: SupabaseClient,
  req: Request,
  ctx: AdminContext,
): Promise<Response> {
  const { data, error } = await db
    .from('ai_rules')
    .select('id, rule_text, active')
    .order('created_at', { ascending: true });
  if (error !== null) {
    serverLog.error('encouragement.rule_list_failed', {});
    return errorResponse(req, 500, 'server_error');
  }
  await writeAudit(db, {
    actorType: 'admin',
    actorId: ctx.subject.subjectId,
    actorRole: ctx.role,
    action: 'read',
    entityType: 'ai_rule',
    entityId: null,
    outcome: 'allowed',
    ip: ctx.ip,
  });
  return jsonResponse(req, 200, {
    rules: data.map((row) => ({
      id: String(row.id),
      text: String(row.rule_text),
      active: row.active === true,
    })),
  });
}

async function handleRuleCreate(
  db: SupabaseClient,
  req: Request,
  ctx: AdminContext,
): Promise<Response> {
  const parsed = createAiRuleSchema.safeParse(await parseJsonBody(req));
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }
  const { data, error } = await db
    .from('ai_rules')
    .insert({ rule_text: parsed.data.text, created_by: ctx.subject.subjectId })
    .select('id')
    .maybeSingle();
  if (error !== null || data === null) {
    serverLog.error('encouragement.rule_create_failed', {});
    return errorResponse(req, 500, 'server_error');
  }
  await writeAudit(db, {
    actorType: 'admin',
    actorId: ctx.subject.subjectId,
    actorRole: ctx.role,
    action: 'create',
    entityType: 'ai_rule',
    entityId: String(data.id),
    outcome: 'allowed',
    ip: ctx.ip,
  });
  return jsonResponse(req, 201, { rule: { id: String(data.id) } });
}

async function handleRuleToggle(
  db: SupabaseClient,
  req: Request,
  ctx: AdminContext,
): Promise<Response> {
  const parsed = toggleAiRuleSchema.safeParse(await parseJsonBody(req));
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }
  const { ruleId, active } = parsed.data;
  const { data, error } = await db
    .from('ai_rules')
    .update({ active })
    .eq('id', ruleId)
    .select('id')
    .maybeSingle();
  if (error !== null) {
    serverLog.error('encouragement.rule_toggle_failed', {});
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
    entityType: 'ai_rule',
    entityId: ruleId,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { active },
  });
  return jsonResponse(req, 200, { rule: { id: ruleId, active } });
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight !== null) {
    return preflight;
  }

  const segments = new URL(req.url).pathname.split('/').filter((s) => s !== '');
  const action = segments.at(-1);
  const parent = segments.at(-2);

  const db = createServiceClient();
  // The AI surface is Kenecia's alone (Spec §6.5: admin-gated; OD-12 keeps it
  // super_admin regardless of how other sections widen).
  const auth = await requireAdmin(db, req, ENTITY, ['super_admin']);
  if (!auth.ok) {
    return auth.response;
  }

  if (action === 'encouragement' && req.method === 'GET') {
    return handleList(db, req, auth.ctx);
  }
  if (action === 'generate' && req.method === 'POST') {
    return handleGenerate(db, req, auth.ctx);
  }
  if (action === 'approve' && req.method === 'POST') {
    return handleApprove(db, req, auth.ctx);
  }
  if (action === 'reject' && req.method === 'POST') {
    return handleReject(db, req, auth.ctx);
  }
  if (action === 'replace' && req.method === 'POST') {
    return handleReplace(db, req, auth.ctx);
  }
  if (action === 'post' && req.method === 'POST') {
    return handlePost(db, req, auth.ctx);
  }
  if (action === 'rules' && req.method === 'GET') {
    return handleRuleList(db, req, auth.ctx);
  }
  if (action === 'rules' && req.method === 'POST') {
    return handleRuleCreate(db, req, auth.ctx);
  }
  if (action === 'toggle' && parent === 'rules' && req.method === 'POST') {
    return handleRuleToggle(db, req, auth.ctx);
  }
  return errorResponse(req, 405, 'method_not_allowed');
});
