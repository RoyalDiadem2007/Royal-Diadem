/**
 * Trust-boundary input schemas (rules §8 step 5): strict — unknown fields are
 * rejected, every field bounded.
 */
import { z } from 'npm:zod@4';

export const loginRequestSchema = z
  .object({
    subjectType: z.enum(['student', 'admin']),
    /** Student crown code or admin email. */
    identifier: z.string().trim().min(1).max(100),
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
  })
  .strict();

export type CreateStudentRequest = z.infer<typeof createStudentSchema>;

export const resetPinSchema = z.object({ studentId: z.uuid() }).strict();

export type ResetPinRequest = z.infer<typeof resetPinSchema>;

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
