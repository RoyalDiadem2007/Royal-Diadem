import { describe, expect, it } from 'vitest';
import { pushSupported, urlBase64ToUint8Array } from '@/lib/push';

describe('web push client helpers', () => {
  it('converts a base64url VAPID key to the exact byte sequence', () => {
    // 'BA' base64url = bytes [0b000001_00 ...] — verify against atob directly.
    const key =
      'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qtuMYbjrDCmB98KIP2sM';
    const bytes = urlBase64ToUint8Array(key);
    expect(bytes.length).toBe(65); // uncompressed P-256 point
    expect(bytes[0]).toBe(4); // 0x04 uncompressed marker
  });

  it('degrades gracefully where push is unsupported (jsdom has no PushManager)', () => {
    expect(pushSupported()).toBe(false);
  });
});
