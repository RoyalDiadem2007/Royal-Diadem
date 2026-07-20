/**
 * student-profile — the Queen Card's server (SXU, Maria's approved model
 * 2026-07-19): her profile, her goals ("What I'm growing toward"), her
 * strengths. Private to her and authorized staff, never public. Free text
 * is encrypted with the journal's application-layer crypto before it
 * touches a row; responses decrypt for HER session only. No rankings, no
 * streaks — status is Not started / Growing / Completed, full stop.
 *
 *   GET  /student-profile                 profile + goals + strengths + options
 *   POST /student-profile/update          { avatarKey, proudOf }
 *   POST /student-profile/goals/create    { title, nextStep, targetDate }
 *   POST /student-profile/goals/update    { goalId, title, nextStep, status, targetDate }
 *   POST /student-profile/strengths       { keys }
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { z } from 'npm:zod@4';
import { createServiceClient } from '../_shared/db.ts';
import { errorResponse, handlePreflight, jsonResponse } from '../_shared/http.ts';
import { requireStudent, type StudentContext } from '../_shared/studentAuth.ts';
import { enforceProfileWriteRateLimit } from '../_shared/rateLimit.ts';
import {
  decryptJournalText,
  encryptJournalText,
  journalCryptoConfigured,
} from '../_shared/journalCrypto.ts';
import { writeAudit } from '../_shared/audit.ts';
import { serverLog } from '../_shared/logger.ts';

const ENTITY = 'student_profile';
/** "Up to three active goals" (SXU brief) — a gentle focus, not a race. */
const ACTIVE_GOAL_LIMIT = 3;
const STRENGTH_LIMIT = 5;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()), 'not a real date');

// Mirror of the build-your-own-avatar vocabulary in src/lib/avatarBuilder.ts.
// Same discipline as the strengths vocabulary: the client offers these keys,
// the server is the boundary that only accepts them. When a facet gains an
// option, update both files.
const AVATAR_VOCABULARY = {
  skin: ['porcelain', 'honey', 'golden', 'amber', 'chestnut', 'espresso'],
  faceShape: ['round', 'oval', 'heart', 'square', 'long'],
  hair: ['afro', 'coils', 'locs', 'braids', 'cornrows', 'puffs'],
  hairColor: ['black', 'espresso', 'chestnut', 'auburn', 'honey'],
  expression: ['smile', 'calm', 'joyful', 'cool'],
  crown: ['classic', 'tiara', 'flowers', 'halo', 'none'],
} as const;

const avatarConfigSchema = z
  .object({
    skin: z.enum(AVATAR_VOCABULARY.skin),
    faceShape: z.enum(AVATAR_VOCABULARY.faceShape),
    hair: z.enum(AVATAR_VOCABULARY.hair),
    hairColor: z.enum(AVATAR_VOCABULARY.hairColor),
    expression: z.enum(AVATAR_VOCABULARY.expression),
    crown: z.enum(AVATAR_VOCABULARY.crown),
  })
  .strict();

const updateProfileSchema = z
  .object({
    avatarKey: z
      .string()
      .regex(/^[a-z0-9-]{1,40}$/)
      .nullable(),
    // Nullish so a caller that predates the builder (sends no avatarConfig)
    // still validates — a missing config is simply "no built avatar".
    avatarConfig: avatarConfigSchema.nullish(),
    proudOf: z.string().trim().min(1).max(500).nullable(),
  })
  .strict();

const createGoalSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    nextStep: z.string().trim().min(1).max(300).nullable(),
    targetDate: isoDate.nullable(),
  })
  .strict();

const updateGoalSchema = z
  .object({
    goalId: z.uuid(),
    title: z.string().trim().min(1).max(160),
    nextStep: z.string().trim().min(1).max(300).nullable(),
    status: z.enum(['not_started', 'growing', 'completed']),
    targetDate: isoDate.nullable(),
  })
  .strict();

const strengthsSchema = z
  .object({ keys: z.array(z.string().regex(/^[a-z0-9-]{1,40}$/)).max(STRENGTH_LIMIT) })
  .strict();

type GoalRow = {
  id: string;
  title_ciphertext: string;
  title_iv: string;
  next_step_ciphertext: string | null;
  next_step_iv: string | null;
  status: string;
  target_date: string | null;
  completed_at: string | null;
};

async function decryptOrNull(
  ciphertext: string | null,
  iv: string | null,
): Promise<string | null> {
  if (ciphertext === null || iv === null) {
    return null;
  }
  return decryptJournalText({ ciphertext, iv });
}

async function limited(
  db: SupabaseClient,
  req: Request,
  ctx: StudentContext,
): Promise<Response | null> {
  const outcome = await enforceProfileWriteRateLimit(db, ctx.subject.subjectId);
  if (!outcome.allowed) {
    return errorResponse(req, 429, 'rate_limited', {
      'Retry-After': String(outcome.retryAfterSeconds),
    });
  }
  return null;
}

async function handleGet(db: SupabaseClient, req: Request, ctx: StudentContext): Promise<Response> {
  const self = ctx.subject.subjectId;

  const [profileRes, goalsRes, strengthsRes, optionsRes] = await Promise.all([
    db
      .from('student_profiles')
      .select('avatar_key, avatar_config, proud_of_ciphertext, proud_of_iv')
      .eq('student_id', self)
      .maybeSingle(),
    db
      .from('student_goals')
      .select(
        'id, title_ciphertext, title_iv, next_step_ciphertext, next_step_iv, status, target_date, completed_at',
      )
      .eq('student_id', self)
      .order('created_at', { ascending: true }),
    db.from('student_strengths').select('strength_key').eq('student_id', self),
    db.from('strength_options').select('key, label').eq('active', true).order('label'),
  ]);
  if (
    profileRes.error !== null ||
    goalsRes.error !== null ||
    strengthsRes.error !== null ||
    optionsRes.error !== null
  ) {
    serverLog.error('student_profile.read_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  const goals = [];
  for (const row of goalsRes.data as GoalRow[]) {
    const title = await decryptOrNull(row.title_ciphertext, row.title_iv);
    if (title === null) {
      serverLog.error('student_profile.goal_decrypt_failed', {});
      return errorResponse(req, 500, 'server_error');
    }
    goals.push({
      id: String(row.id),
      title,
      nextStep: await decryptOrNull(row.next_step_ciphertext, row.next_step_iv),
      status: row.status,
      targetDate: row.target_date,
      completedAt: row.completed_at,
    });
  }

  const proudOf = await decryptOrNull(
    (profileRes.data?.proud_of_ciphertext as string | null | undefined) ?? null,
    (profileRes.data?.proud_of_iv as string | null | undefined) ?? null,
  );

  await writeAudit(db, {
    actorType: 'student',
    actorId: self,
    actorRole: 'student',
    action: 'read',
    entityType: ENTITY,
    entityId: self,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { goals: goals.length },
  });

  // avatar_config is validated on write, so a stored value already matches
  // the vocabulary; re-parse defensively so a hand-edited row can't leak a
  // malformed shape to the client.
  const storedConfig = profileRes.data?.avatar_config ?? null;
  const avatarConfig = avatarConfigSchema.safeParse(storedConfig);

  return jsonResponse(req, 200, {
    profile: {
      avatarKey: (profileRes.data?.avatar_key as string | null | undefined) ?? null,
      avatarConfig: avatarConfig.success ? avatarConfig.data : null,
      proudOf,
    },
    goals,
    strengths: strengthsRes.data.map((row) => String(row.strength_key)),
    strengthOptions: optionsRes.data.map((row) => ({
      key: String(row.key),
      label: String(row.label),
    })),
  });
}

async function handleUpdateProfile(
  db: SupabaseClient,
  req: Request,
  ctx: StudentContext,
  body: unknown,
): Promise<Response> {
  const parsed = updateProfileSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }
  const rate = await limited(db, req, ctx);
  if (rate !== null) {
    return rate;
  }

  let proudOfCiphertext: string | null = null;
  let proudOfIv: string | null = null;
  if (parsed.data.proudOf !== null) {
    const encrypted = await encryptJournalText(parsed.data.proudOf);
    if (encrypted === null) {
      serverLog.error('student_profile.encrypt_failed', {});
      return errorResponse(req, 500, 'server_error');
    }
    proudOfCiphertext = encrypted.ciphertext;
    proudOfIv = encrypted.iv;
  }

  const { error } = await db.from('student_profiles').upsert(
    {
      student_id: ctx.subject.subjectId,
      avatar_key: parsed.data.avatarKey,
      avatar_config: parsed.data.avatarConfig ?? null,
      proud_of_ciphertext: proudOfCiphertext,
      proud_of_iv: proudOfIv,
    },
    { onConflict: 'student_id' },
  );
  if (error !== null) {
    serverLog.error('student_profile.update_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  await writeAudit(db, {
    actorType: 'student',
    actorId: ctx.subject.subjectId,
    actorRole: 'student',
    action: 'update',
    entityType: ENTITY,
    entityId: ctx.subject.subjectId,
    outcome: 'allowed',
    ip: ctx.ip,
  });

  return jsonResponse(req, 200, { saved: true });
}

async function handleCreateGoal(
  db: SupabaseClient,
  req: Request,
  ctx: StudentContext,
  body: unknown,
): Promise<Response> {
  const parsed = createGoalSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }
  const rate = await limited(db, req, ctx);
  if (rate !== null) {
    return rate;
  }

  // A gentle focus: at most three goals still in motion.
  const { count, error: countError } = await db
    .from('student_goals')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', ctx.subject.subjectId)
    .neq('status', 'completed');
  if (countError !== null || count === null) {
    serverLog.error('student_profile.goal_count_failed', {});
    return errorResponse(req, 500, 'server_error');
  }
  if (count >= ACTIVE_GOAL_LIMIT) {
    return errorResponse(req, 409, 'goal_limit');
  }

  const title = await encryptJournalText(parsed.data.title);
  if (title === null) {
    serverLog.error('student_profile.encrypt_failed', {});
    return errorResponse(req, 500, 'server_error');
  }
  let nextStep: { ciphertext: string; iv: string } | null = null;
  if (parsed.data.nextStep !== null) {
    nextStep = await encryptJournalText(parsed.data.nextStep);
    if (nextStep === null) {
      serverLog.error('student_profile.encrypt_failed', {});
      return errorResponse(req, 500, 'server_error');
    }
  }

  const { data, error } = await db
    .from('student_goals')
    .insert({
      student_id: ctx.subject.subjectId,
      title_ciphertext: title.ciphertext,
      title_iv: title.iv,
      next_step_ciphertext: nextStep?.ciphertext ?? null,
      next_step_iv: nextStep?.iv ?? null,
      target_date: parsed.data.targetDate,
    })
    .select('id')
    .single();
  if (error !== null) {
    serverLog.error('student_profile.goal_insert_failed', {});
    return errorResponse(req, 500, 'server_error');
  }

  await writeAudit(db, {
    actorType: 'student',
    actorId: ctx.subject.subjectId,
    actorRole: 'student',
    action: 'create',
    entityType: 'student_goal',
    entityId: String(data.id),
    outcome: 'allowed',
    ip: ctx.ip,
  });

  return jsonResponse(req, 201, { goalId: String(data.id) });
}

async function handleUpdateGoal(
  db: SupabaseClient,
  req: Request,
  ctx: StudentContext,
  body: unknown,
): Promise<Response> {
  const parsed = updateGoalSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }
  const rate = await limited(db, req, ctx);
  if (rate !== null) {
    return rate;
  }

  const title = await encryptJournalText(parsed.data.title);
  if (title === null) {
    serverLog.error('student_profile.encrypt_failed', {});
    return errorResponse(req, 500, 'server_error');
  }
  let nextStep: { ciphertext: string; iv: string } | null = null;
  if (parsed.data.nextStep !== null) {
    nextStep = await encryptJournalText(parsed.data.nextStep);
    if (nextStep === null) {
      serverLog.error('student_profile.encrypt_failed', {});
      return errorResponse(req, 500, 'server_error');
    }
  }

  // Her own goal only — the id filter pairs with the student filter.
  const { data, error } = await db
    .from('student_goals')
    .update({
      title_ciphertext: title.ciphertext,
      title_iv: title.iv,
      next_step_ciphertext: nextStep?.ciphertext ?? null,
      next_step_iv: nextStep?.iv ?? null,
      status: parsed.data.status,
      target_date: parsed.data.targetDate,
      completed_at: parsed.data.status === 'completed' ? new Date().toISOString() : null,
    })
    .eq('id', parsed.data.goalId)
    .eq('student_id', ctx.subject.subjectId)
    .select('id')
    .maybeSingle();
  if (error !== null) {
    serverLog.error('student_profile.goal_update_failed', {});
    return errorResponse(req, 500, 'server_error');
  }
  if (data === null) {
    return errorResponse(req, 404, 'not_found');
  }

  await writeAudit(db, {
    actorType: 'student',
    actorId: ctx.subject.subjectId,
    actorRole: 'student',
    action: 'update',
    entityType: 'student_goal',
    entityId: parsed.data.goalId,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { goalStatus: parsed.data.status },
  });

  return jsonResponse(req, 200, { saved: true });
}

async function handleSetStrengths(
  db: SupabaseClient,
  req: Request,
  ctx: StudentContext,
  body: unknown,
): Promise<Response> {
  const parsed = strengthsSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(req, 400, 'invalid_request');
  }
  const rate = await limited(db, req, ctx);
  if (rate !== null) {
    return rate;
  }
  const keys = [...new Set(parsed.data.keys)];

  // Only the administrator-approved vocabulary counts.
  if (keys.length > 0) {
    const { data: valid, error: validError } = await db
      .from('strength_options')
      .select('key')
      .eq('active', true)
      .in('key', keys);
    if (validError !== null) {
      serverLog.error('student_profile.strength_lookup_failed', {});
      return errorResponse(req, 500, 'server_error');
    }
    if (valid.length !== keys.length) {
      return errorResponse(req, 400, 'invalid_request');
    }
  }

  const self = ctx.subject.subjectId;
  const { error: clearError } = await db
    .from('student_strengths')
    .delete()
    .eq('student_id', self);
  if (clearError !== null) {
    serverLog.error('student_profile.strength_clear_failed', {});
    return errorResponse(req, 500, 'server_error');
  }
  if (keys.length > 0) {
    const { error: insertError } = await db
      .from('student_strengths')
      .insert(keys.map((key) => ({ student_id: self, strength_key: key })));
    if (insertError !== null) {
      serverLog.error('student_profile.strength_insert_failed', {});
      return errorResponse(req, 500, 'server_error');
    }
  }

  await writeAudit(db, {
    actorType: 'student',
    actorId: self,
    actorRole: 'student',
    action: 'update',
    entityType: 'student_strengths',
    entityId: self,
    outcome: 'allowed',
    ip: ctx.ip,
    metadata: { count: keys.length },
  });

  return jsonResponse(req, 200, { saved: true });
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight !== null) {
    return preflight;
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return errorResponse(req, 405, 'method_not_allowed');
  }
  if (!(await journalCryptoConfigured())) {
    // Fail closed: without the key nothing regulated moves (journal rule).
    serverLog.error('student_profile.crypto_unconfigured', {});
    return errorResponse(req, 503, 'server_error');
  }

  const segments = new URL(req.url).pathname.split('/').filter((s) => s !== '');
  const action = segments.at(-1);
  const parent = segments.at(-2);

  const db = createServiceClient();
  const auth = await requireStudent(db, req, ENTITY);
  if (!auth.ok) {
    return auth.response;
  }

  if (req.method === 'GET') {
    return action === 'student-profile'
      ? handleGet(db, req, auth.ctx)
      : errorResponse(req, 404, 'not_found');
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, 400, 'invalid_request');
  }

  if (action === 'update' && parent === 'student-profile') {
    return handleUpdateProfile(db, req, auth.ctx, body);
  }
  if (action === 'create' && parent === 'goals') {
    return handleCreateGoal(db, req, auth.ctx, body);
  }
  if (action === 'update' && parent === 'goals') {
    return handleUpdateGoal(db, req, auth.ctx, body);
  }
  if (action === 'strengths') {
    return handleSetStrengths(db, req, auth.ctx, body);
  }
  return errorResponse(req, 404, 'not_found');
});
