/**
 * Trust-boundary input schemas (rules §8 step 5): strict — unknown fields are
 * rejected, every field bounded.
 */
import { z } from 'npm:zod@4';

export const loginRequestSchema = z
  .object({
    subjectType: z.enum(['student', 'admin', 'guardian']),
    /** Student crown code, or admin/guardian email. */
    identifier: z.string().trim().min(1).max(254),
    pin: z.string().regex(/^\d{4,8}$/, 'PIN must be 4-8 digits'),
    turnstileToken: z.string().min(10).max(3000),
  })
  .strict();

export type LoginRequest = z.infer<typeof loginRequestSchema>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Individual enrollment (Spec §6.10 enrollment tools). */
export const createStudentSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    displayName: z.string().trim().min(1).max(100),
    dateOfBirth: z
      .string()
      .regex(ISO_DATE, 'date of birth must be YYYY-MM-DD')
      .refine((value) => {
        const parsed = new Date(`${value}T00:00:00Z`);
        return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
      }, 'date of birth must be a real calendar date')
      .refine(
        (value) => new Date(`${value}T00:00:00Z`).getTime() < Date.now(),
        'date of birth must be in the past',
      ),
    gradeLevel: z.string().trim().min(1).max(100).optional(),
    schoolName: z.string().trim().min(1).max(100).optional(),
    phase: z.string().trim().min(1).max(100).optional(),
    /** 13+ only (OD-19) — the server rejects it for under-13 enrollments. */
    studentEmail: z.email().trim().max(254).optional(),
    guardianName: z.string().trim().min(1).max(200).optional(),
    guardianEmail: z.email().trim().max(254).optional(),
    guardianRelationship: z.enum(['parent', 'legal_guardian', 'other']).optional(),
  })
  .strict()
  // A guardian is one record: an email without a name (or vice versa) is a
  // half-entered form, not a guardian.
  .refine(
    (value) => (value.guardianEmail === undefined) === (value.guardianName === undefined),
    'guardian name and email must be provided together',
  );

export type CreateStudentRequest = z.infer<typeof createStudentSchema>;

export const resetPinSchema = z.object({ studentId: z.uuid() }).strict();

export type ResetPinRequest = z.infer<typeof resetPinSchema>;

/** Admin request to (re)send a first-login magic link (OD-19). */
export const sendLinkSchema = z.object({ studentId: z.uuid() }).strict();

/** Admin: invite this student's guardian to the portal (OD-19 build B). */
export const inviteGuardianSchema = z.object({ studentId: z.uuid() }).strict();

/** super_admin crisis path: guardian access without the ceremony. */
export const emergencyAccessSchema = z.object({ studentId: z.uuid() }).strict();

/** Guardian asks to view a linked student's account. */
export const requestAccessSchema = z.object({ studentId: z.uuid() }).strict();

/** Student journal entry (Spec §6.4). Text is encrypted before insert. */
export const writeJournalSchema = z
  .object({
    promptId: z.uuid().optional(),
    text: z.string().trim().min(1).max(4000),
  })
  .strict();

export type WriteJournalRequest = z.infer<typeof writeJournalSchema>;

export const createPromptSchema = z
  .object({ text: z.string().trim().min(1).max(500) })
  .strict();

export const togglePromptSchema = z
  .object({ promptId: z.uuid(), active: z.boolean() })
  .strict();

/** Encouragement Engine (Phase 7). weekOf must be a Monday (checked in the
 * handler — zod validates shape, the calendar rule is domain logic). */
export const generateWeekSchema = z
  .object({ weekOf: z.string().regex(ISO_DATE) })
  .strict();

export const approveMessageSchema = z.object({ messageId: z.uuid() }).strict();

export const rejectMessageSchema = z
  .object({
    messageId: z.uuid(),
    reason: z.string().trim().min(1).max(500),
    ruleId: z.uuid().optional(),
  })
  .strict();

export const replaceMessageSchema = z
  .object({
    messageId: z.uuid(),
    text: z.string().trim().min(1).max(280),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const postWeekSchema = z.object({ weekOf: z.string().regex(ISO_DATE) }).strict();

export const createAiRuleSchema = z
  .object({ text: z.string().trim().min(1).max(500) })
  .strict();

export const toggleAiRuleSchema = z
  .object({ ruleId: z.uuid(), active: z.boolean() })
  .strict();

/** Guardian enters the consent code the student shared with them. */
export const enterCodeSchema = z
  .object({
    studentId: z.uuid(),
    code: z.string().regex(/^\d{6}$/, 'consent code is 6 digits'),
  })
  .strict();

export type SendLinkRequest = z.infer<typeof sendLinkSchema>;

/** Public claim of an emailed magic link — Turnstile-gated like login. */
export const claimLinkSchema = z
  .object({
    token: z.string().trim().min(20).max(200),
    turnstileToken: z.string().min(10).max(3000),
  })
  .strict();

export type ClaimLinkRequest = z.infer<typeof claimLinkSchema>;

/**
 * One CSV-import chunk. Small on purpose: bcrypt(12) per row is CPU-heavy for
 * an Edge Function, so the client slices a big file into chunks of ≤10.
 */
export const importStudentsSchema = z
  .object({
    rows: z.array(createStudentSchema).min(1).max(10),
  })
  .strict();

export type ImportStudentsRequest = z.infer<typeof importStudentsSchema>;

/**
 * Crown Check submission (Spec §6.2). The emoji is display data the client
 * derived from the score's tier; it is bounded, never trusted as meaning.
 */
export const submitCrownCheckSchema = z
  .object({
    moodScore: z.number().int().min(1).max(5),
    moodEmoji: z.string().trim().min(1).max(16),
    note: z.string().trim().min(1).max(280).optional(),
  })
  .strict();

export type SubmitCrownCheckRequest = z.infer<typeof submitCrownCheckSchema>;

export async function parseJsonBody(req: Request, maxBytes = 10_000): Promise<unknown | null> {
  const lengthHeader = req.headers.get('content-length');
  if (lengthHeader !== null && Number(lengthHeader) > maxBytes) {
    return null;
  }
  try {
    const text = await req.text();
    if (text.length > maxBytes) {
      return null;
    }
    return JSON.parse(text) as unknown;
  } catch {
    // Malformed JSON is a client error, reported as such by the caller.
    return null;
  }
}
