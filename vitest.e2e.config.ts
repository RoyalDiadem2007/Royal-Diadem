import { defineConfig } from 'vitest/config';

/**
 * E2E suite — real HTTP against the local Supabase stack (real Postgres, real
 * Edge Functions, real bcrypt/rate limiter/audit log). Run via `npm run
 * test:e2e` with the stack up:
 *
 *   npx supabase start
 *   npx supabase functions serve --env-file supabase/functions/.env
 *
 * Not part of `npm test` (unit gates) because it needs Docker; CI runs it as
 * its own job.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/e2e/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Login attempts share a per-IP rate-limit budget; run serially so the
    // suite's arithmetic is deterministic.
    fileParallelism: false,
  },
});
