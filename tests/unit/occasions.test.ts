import { describe, expect, it } from 'vitest';
import { upcomingOccasions, pickOccasion, OCCASION_CATEGORIES } from '@/lib/creative/planner';
import { DirectionSchema } from '@/lib/validation';
import { OCCASIONS } from '@/lib/creative/options';

describe('Bahraini occasions calendar', () => {
  const now = new Date('2026-11-12T09:00:00+03:00');
  it('lists upcoming occasions in order with countdown and campaign dates', () => {
    const l = upcomingOccasions(now, 150);
    const keys = l.map((w) => w.key);
    for (const k of ['bahraini_women_day', 'bahrain_national_day', 'new_year', 'ramadan', 'gergaoon', 'eid_fitr', 'mothers_day']) expect(keys).toContain(k);
    const nd = l.find((w) => w.key === 'bahrain_national_day')!;
    expect(nd.daysToPeak).toBe(34);
    expect(nd.startAt.toISOString()).toBe(new Date('2026-12-01T00:00:00+03:00').toISOString());
    expect(nd.endAt.getTime() - nd.peak.getTime()).toBe(86400_000);
    expect(l.map((w) => w.peak.getTime())).toEqual([...l.map((w) => w.peak.getTime())].sort((a, b) => a - b));
    const g = l.find((w) => w.key === 'gergaoon')!;
    expect(g.peak.toISOString()).toBe(new Date('2027-02-22T00:00:00+03:00').toISOString()); // 15 Ramadan 1448 (estimate)
  });
  it('new occasions are valid choices, have category suggestions and appear automatically in their window', () => {
    for (const k of ['gergaoon', 'bahraini_women_day', 'teachers_day']) {
      expect(OCCASIONS.some((o) => o.value === k)).toBe(true);
      expect(OCCASION_CATEGORIES[k]?.length).toBeGreaterThan(0);
      expect(DirectionSchema.parse({ occasion: k })).toMatchObject({ occasion: k });
    }
    expect(pickOccasion(new Date('2026-11-30T10:00:00+03:00'), { language: 'ar', market: 'BH' }, () => 0)).toBe('bahraini_women_day');
    expect(pickOccasion(new Date('2026-11-30T10:00:00+03:00'), { language: 'ar', market: 'KSA' }, () => 0)).not.toBe('bahraini_women_day');
  });
});
