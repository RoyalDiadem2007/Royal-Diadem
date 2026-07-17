/**
 * Credential generation for student enrollment (Spec §5, §13 Phase 4).
 * Crown codes are non-secret identifiers printed on the PIN card; PINs are
 * secrets — generated with rejection sampling (no modulo bias), returned to
 * the enrolling admin exactly once, stored only as a bcrypt hash.
 */

/** Unambiguous alphabet — no 0/O, 1/I/L — so a printed card can't be misread. */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_SUFFIX_LENGTH = 4;
const PIN_DIGITS = 6;

/**
 * White-label rule (§4.5): the prefix is deployment configuration, not code.
 * 'RD' is this deployment's configured default; other tenants set
 * CROWN_CODE_PREFIX as a function secret.
 */
export function crownCodePrefix(): string {
  const configured = Deno.env.get('CROWN_CODE_PREFIX')?.trim();
  return configured !== undefined && configured !== '' ? configured : 'RD';
}

/**
 * e.g. RD-7F3K. The tiny modulo bias here is acceptable: the code is a
 * printed, non-secret identifier whose uniqueness the database enforces.
 */
export function generateCrownCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_SUFFIX_LENGTH));
  let suffix = '';
  for (const b of bytes) {
    suffix += CODE_ALPHABET[b % CODE_ALPHABET.length] ?? '';
  }
  return `${crownCodePrefix()}-${suffix}`;
}

/** Crypto-random 6-digit PIN (leading zeros allowed), unbiased. */
export function generatePin(): string {
  const range = 10 ** PIN_DIGITS;
  // Largest multiple of `range` inside uint32 space — reject above it.
  const limit = Math.floor(0x1_0000_0000 / range) * range;
  for (;;) {
    const buffer = crypto.getRandomValues(new Uint8Array(4));
    const n = new DataView(buffer.buffer).getUint32(0);
    if (n < limit) {
      return String(n % range).padStart(PIN_DIGITS, '0');
    }
  }
}

/** Whole-year age on `on` for a YYYY-MM-DD date of birth. */
export function ageOn(dateOfBirth: string, on: Date): number {
  const dob = new Date(`${dateOfBirth}T00:00:00Z`);
  let age = on.getUTCFullYear() - dob.getUTCFullYear();
  const hadBirthday =
    on.getUTCMonth() > dob.getUTCMonth() ||
    (on.getUTCMonth() === dob.getUTCMonth() && on.getUTCDate() >= dob.getUTCDate());
  if (!hadBirthday) {
    age -= 1;
  }
  return age;
}
