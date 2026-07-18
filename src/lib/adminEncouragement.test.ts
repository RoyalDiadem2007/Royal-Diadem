import { describe, expect, it } from 'vitest';
import { mondayOf, shiftWeek } from '@/lib/adminEncouragement';

describe('week helpers', () => {
  it('finds the Monday of any weekday', () => {
    expect(mondayOf(new Date(2026, 6, 17))).toBe('2026-07-13'); // a Friday
    expect(mondayOf(new Date(2026, 6, 13))).toBe('2026-07-13'); // Monday itself
    expect(mondayOf(new Date(2026, 6, 19))).toBe('2026-07-13'); // Sunday belongs to the past week
  });

  it('shifts whole weeks in both directions', () => {
    expect(shiftWeek('2026-07-13', 1)).toBe('2026-07-20');
    expect(shiftWeek('2026-07-13', -2)).toBe('2026-06-29');
  });
});
