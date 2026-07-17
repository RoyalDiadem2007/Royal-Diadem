/**
 * Journal encryption (OD-2, decided 2026-07-16): application-layer AES-256-GCM
 * inside the Edge Function, server-held key — the database never sees journal
 * plaintext, and neither does any client cache. Deliberately NOT end-to-end:
 * the transparency model (Spec §6.4) requires her mentor to read entries, and
 * OD-19 lets a guardian read them inside a consent window.
 *
 * Key: JOURNAL_ENCRYPTION_KEY function secret, base64 of 32 random bytes
 * (KEYS_SETUP §1d). Missing/malformed key → callers fail closed with a clear
 * code; never a plaintext fallback.
 */
import { serverLog } from './logger.ts';

const IV_BYTES = 12; // GCM standard nonce size

let cachedKey: Promise<CryptoKey | null> | null = null;

function importJournalKey(): Promise<CryptoKey | null> {
  cachedKey ??= (async () => {
    const raw = Deno.env.get('JOURNAL_ENCRYPTION_KEY');
    if (raw === undefined || raw.trim() === '') {
      return null;
    }
    try {
      const bytes = Uint8Array.from(atob(raw.trim()), (c) => c.charCodeAt(0));
      if (bytes.length !== 32) {
        serverLog.error('journal_crypto.bad_key_length', { keyBytes: bytes.length });
        return null;
      }
      return await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, [
        'encrypt',
        'decrypt',
      ]);
    } catch {
      serverLog.error('journal_crypto.key_import_failed', {});
      return null;
    }
  })();
  return cachedKey;
}

export async function journalCryptoConfigured(): Promise<boolean> {
  return (await importJournalKey()) !== null;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export type EncryptedText = { ciphertext: string; iv: string };

export async function encryptJournalText(plaintext: string): Promise<EncryptedText | null> {
  const key = await importJournalKey();
  if (key === null) {
    return null;
  }
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  try {
    const cipherBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(plaintext),
    );
    return { ciphertext: toBase64(new Uint8Array(cipherBuffer)), iv: toBase64(iv) };
  } catch {
    serverLog.error('journal_crypto.encrypt_failed', {});
    return null;
  }
}

/** Null on any failure (wrong key, tampered ciphertext) — fail closed. */
export async function decryptJournalText(encrypted: EncryptedText): Promise<string | null> {
  const key = await importJournalKey();
  if (key === null) {
    return null;
  }
  try {
    const plainBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(encrypted.iv) },
      key,
      fromBase64(encrypted.ciphertext),
    );
    return new TextDecoder().decode(plainBuffer);
  } catch {
    // Tampered row or rotated key — surfaced, never guessed around.
    serverLog.error('journal_crypto.decrypt_failed', {});
    return null;
  }
}
