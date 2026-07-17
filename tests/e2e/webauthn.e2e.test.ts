/**
 * WebAuthn endpoint E2E — real HTTP against the real stack. Covers everything
 * testable WITHOUT a hardware/virtual authenticator: session gating, real
 * option generation, challenge single-use semantics, and rejection of forged
 * assertions. The full happy-path ceremony (an actual signed assertion) needs
 * a browser virtual authenticator — tracked in PROJECT_STATE as a follow-up
 * when browser-driven tests (Playwright) arrive with the admin panel phase.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callFunction, restDelete, restInsert, restSelect } from './stack.ts';

const PIN_HASH_123456 = '$2b$12$6dESXMU6poUgaUoSTSce.ezSDJsy6vs4Pn4Ho5DFPOxoaxxXpRjMq';
const PIN = '123456';
const TURNSTILE_TOKEN = 'e2e-test-token-XXXX.DUMMY.TOKEN.XXXX';
const STUDENT_CODE = 'rd-e2e-wa';

let sessionToken = '';

type CeremonyOptions = { challenge?: string; rp?: { id?: string }; rpId?: string };

async function optionsFrom(res: Response): Promise<CeremonyOptions> {
  const body = (await res.json()) as { options?: CeremonyOptions };
  return body.options ?? {};
}

async function cleanup(): Promise<void> {
  await restDelete('webauthn_challenges', 'purpose=in.(registration,authentication)');
  await restDelete('webauthn_credentials', 'subject_type=eq.student');
  await restDelete('sessions', 'subject_type=eq.student');
  await restDelete('auth_rate_limits', 'limit_key=like.webauthn%');
  await restDelete('students', `login_code=eq.${STUDENT_CODE}`);
}

beforeAll(async () => {
  await cleanup();
  await restInsert('students', [
    {
      first_name: 'Nia',
      last_name: 'Example',
      display_name: 'Nia',
      date_of_birth: '2011-03-03',
      pin_hash: PIN_HASH_123456,
      login_code: STUDENT_CODE,
      status: 'active',
      coppa_required: false,
      coppa_consent_status: 'verified',
    },
  ]);

  const login = await callFunction('auth-login', {
    method: 'POST',
    body: {
      subjectType: 'student',
      identifier: STUDENT_CODE,
      pin: PIN,
      turnstileToken: TURNSTILE_TOKEN,
    },
  });
  if (login.status !== 200) {
    throw new Error(`setup login failed: ${String(login.status)}`);
  }
  const body = (await login.json()) as { token?: string; webauthnRegistered?: boolean };
  if (typeof body.token !== 'string') {
    throw new Error('setup login returned no token');
  }
  if (body.webauthnRegistered !== false) {
    throw new Error('fresh account should report webauthnRegistered=false');
  }
  sessionToken = body.token;
});

afterAll(async () => {
  await cleanup();
});

describe('webauthn endpoints end-to-end (real stack)', () => {
  it('refuses registration options without a session', async () => {
    const res = await callFunction('auth-webauthn-register/options', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('issues real registration options for a signed-in student', async () => {
    const res = await callFunction('auth-webauthn-register/options', {
      method: 'POST',
      bearer: sessionToken,
    });
    expect(res.status).toBe(200);

    const options = await optionsFrom(res);
    expect(typeof options.challenge).toBe('string');
    expect((options.challenge ?? '').length).toBeGreaterThan(16);
    expect(options.rp?.id).toBe('localhost');

    // The challenge is genuinely persisted server-side.
    const stored = await restSelect(
      'webauthn_challenges',
      `challenge=eq.${options.challenge ?? ''}&purpose=eq.registration`,
    );
    expect(stored.length).toBe(1);
  });

  it('rejects a registration verify with an unknown challenge', async () => {
    const res = await callFunction('auth-webauthn-register/verify', {
      method: 'POST',
      bearer: sessionToken,
      body: {
        challenge: 'never-issued-challenge',
        response: { id: 'x', rawId: 'x', type: 'public-key', response: {} },
      },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('invalid_challenge');
  });

  it('issues authentication options with no identifier (usernameless)', async () => {
    const res = await callFunction('auth-webauthn-login/options', { method: 'POST' });
    expect(res.status).toBe(200);
    const options = await optionsFrom(res);
    expect(typeof options.challenge).toBe('string');
  });

  it('consumes a challenge on first use — forged assertion then replay both fail', async () => {
    const optionsRes = await callFunction('auth-webauthn-login/options', { method: 'POST' });
    const options = await optionsFrom(optionsRes);
    const challenge = options.challenge ?? '';
    expect(challenge.length).toBeGreaterThan(0);

    // Forged assertion referencing a credential that does not exist: denied,
    // and the challenge is burned in the process.
    const first = await callFunction('auth-webauthn-login/verify', {
      method: 'POST',
      body: {
        challenge,
        response: { id: 'no-such-credential', rawId: 'x', type: 'public-key', response: {} },
      },
    });
    expect(first.status).toBe(401);
    const firstBody = (await first.json()) as { error?: string };
    expect(firstBody.error).toBe('invalid_credentials');

    // Replay with the same challenge: it no longer exists.
    const replay = await callFunction('auth-webauthn-login/verify', {
      method: 'POST',
      body: {
        challenge,
        response: { id: 'no-such-credential', rawId: 'x', type: 'public-key', response: {} },
      },
    });
    expect(replay.status).toBe(401);
    const replayBody = (await replay.json()) as { error?: string };
    expect(replayBody.error).toBe('invalid_challenge');

    // The unknown-credential denial reached the audit log.
    const audits = await restSelect(
      'audit_logs',
      'entity_type=eq.webauthn_credential&outcome=eq.denied&order=created_at.desc&limit=5',
    );
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects malformed ceremony bodies outright', async () => {
    const res = await callFunction('auth-webauthn-login/verify', {
      method: 'POST',
      body: { nonsense: true },
    });
    expect(res.status).toBe(400);
  });
});
