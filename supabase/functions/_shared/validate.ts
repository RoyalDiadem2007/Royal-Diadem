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
