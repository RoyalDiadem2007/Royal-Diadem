import { describe, expect, it } from 'vitest';
import { buildIcs, hourAfter } from '@/lib/ics';

describe('hourAfter', () => {
  it('adds one hour keeping the minutes', () => {
    expect(hourAfter('15:30')).toBe('16:30');
    expect(hourAfter('09:05')).toBe('10:05');
  });

  it('caps at the end of the day instead of rolling over', () => {
    expect(hourAfter('23:45')).toBe('23:45');
  });
});

describe('buildIcs', () => {
  const base = {
    uid: 'req-1@mentor-session',
    title: 'Mentor time',
    date: '2026-08-03',
    startTime: '15:30',
    now: new Date('2026-07-19T10:00:00.000Z'),
  };

  it('emits a complete VCALENDAR with floating local times', () => {
    const ics = buildIcs({ ...base, endTime: '16:15' });
    const lines = ics.split('\r\n');
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines.at(-1)).toBe('END:VCALENDAR');
    expect(ics).toContain('UID:req-1@mentor-session');
    expect(ics).toContain('DTSTAMP:20260719T100000Z');
    expect(ics).toContain('DTSTART:20260803T153000');
    expect(ics).toContain('DTEND:20260803T161500');
    expect(ics).toContain('SUMMARY:Mentor time');
  });

  it('defaults a null end time to one hour', () => {
    const ics = buildIcs({ ...base, endTime: null });
    expect(ics).toContain('DTEND:20260803T163000');
  });

  it('never leaks more than the generic title', () => {
    const ics = buildIcs({ ...base, endTime: null });
    // The whole payload is structural except UID, times, and the title.
    expect(ics).not.toMatch(/student|mentor-sessions|royal/i);
  });
});
