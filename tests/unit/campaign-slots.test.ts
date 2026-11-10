import { describe, expect, it } from 'vitest';
import { formatInTimeZone } from 'date-fns-tz';
import { bestHoursFor, nextSlot, previewSlots, type SlotRule } from '@/lib/campaigns/slots';

const fmt = (d: Date | null) => (d ? formatInTimeZone(d, 'Asia/Bahrain', 'EEE yyyy-MM-dd HH:mm') : null);
const base: SlotRule = { scheduleType: 'RECURRING', everyHours: 6, daysOfWeek: [], timeMode: 'FIXED', startAt: new Date('2026-11-12T06:00:00Z'), runs: 0 }; // Thu 09:00 Bahrain

describe('campaign slot calculator (Asia/Bahrain)', () => {
  it('ONCE: exact date/time, only once', () => {
    const r: SlotRule = { ...base, scheduleType: 'ONCE' };
    expect(fmt(nextSlot(r, new Date('2026-11-10T00:00:00Z')))).toBe('Thu 2026-11-12 09:00');
    expect(nextSlot({ ...r, runs: 1 }, new Date('2026-11-10T00:00:00Z'))).toBeNull();
    expect(nextSlot(r, new Date('2026-11-13T00:00:00Z'))).toBeNull();
  });
  it('FIXED: every N hours from the chosen start time', () => {
    expect(previewSlots(base, new Date('2026-11-10T00:00:00Z'), 4).map(fmt)).toEqual(['Thu 2026-11-12 09:00', 'Thu 2026-11-12 15:00', 'Thu 2026-11-12 21:00', 'Fri 2026-11-13 03:00']);
  });
  it('FIXED: respects selected days (Sun=0 … Sat=6)', () => {
    const r = { ...base, everyHours: 24, daysOfWeek: [0, 2] }; // Sunday, Tuesday
    expect(previewSlots(r, new Date('2026-11-10T00:00:00Z'), 3).map(fmt)).toEqual(['Sun 2026-11-15 09:00', 'Tue 2026-11-17 09:00', 'Sun 2026-11-22 09:00']);
  });
  it('BEST: peak hours per day based on the interval, from the start date', () => {
    expect(bestHoursFor(24)).toEqual([20]);
    expect(bestHoursFor(8)).toEqual([13, 20, 21]);
    const r: SlotRule = { ...base, timeMode: 'BEST', everyHours: 12 };
    expect(previewSlots(r, new Date('2026-11-10T00:00:00Z'), 3).map(fmt)).toEqual(['Thu 2026-11-12 13:00', 'Thu 2026-11-12 20:00', 'Fri 2026-11-13 13:00']);
  });
  it('BEST: every 2 days at the best hour, only on allowed days', () => {
    const r: SlotRule = { ...base, timeMode: 'BEST', everyHours: 48 };
    expect(previewSlots(r, new Date('2026-11-10T00:00:00Z'), 3).map(fmt)).toEqual(['Thu 2026-11-12 20:00', 'Sat 2026-11-14 20:00', 'Mon 2026-11-16 20:00']);
  });
  it('stops at end date and max runs, never returns past slots', () => {
    const r = { ...base, endAt: new Date('2026-11-12T13:00:00Z') };
    expect(previewSlots(r, new Date('2026-11-10T00:00:00Z'), 10)).toHaveLength(2);
    expect(nextSlot({ ...base, maxRuns: 3, runs: 3 }, new Date('2026-11-10T00:00:00Z'))).toBeNull();
    const now = new Date('2026-11-12T10:00:00Z'); // 13:00 Bahrain
    expect(nextSlot(base, now)!.getTime()).toBeGreaterThan(now.getTime());
  });
});
