import { describe, expect, it } from 'vitest';
import { MOOD_SCALE, moodTierFor, NOTE_MAX_LENGTH } from '@/config/crownCheck.config';

describe('crown check mood scale', () => {
  it('defines exactly five tiers scoring 1 through 5 in order', () => {
    expect(MOOD_SCALE.map((tier) => tier.score)).toEqual([1, 2, 3, 4, 5]);
  });

  it('gives every tier a non-empty emoji and label', () => {
    for (const tier of MOOD_SCALE) {
      expect(tier.emoji).not.toBe('');
      expect(tier.label).not.toBe('');
    }
  });

  it('resolves a tier by score and rejects out-of-scale values', () => {
    expect(moodTierFor(3)?.score).toBe(3);
    expect(moodTierFor(0)).toBeUndefined();
    expect(moodTierFor(6)).toBeUndefined();
  });

  it('bounds the note to the server contract', () => {
    expect(NOTE_MAX_LENGTH).toBe(280);
  });
});
