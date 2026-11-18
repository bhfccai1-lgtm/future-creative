import { describe, expect, it } from 'vitest';
import { nthWeekday, seasonalWindows, activeOccasions, pickOccasion, upcomingOccasions } from '@/lib/creative/planner';
import { OCCASIONS } from '@/lib/creative/options';

const peak = (y: number, key: string) => seasonalWindows(y).find((w) => w.key === key)!.peak.toISOString().slice(0, 10);
describe('occasions calendar', () => {
  it('computed weekdays are exact', () => {
    expect(nthWeekday(2026, 6, 0, 3)).toBe('2026-06-21'); // Father's Day 2026 = 3rd Sunday of June
    expect(nthWeekday(2027, 6, 0, 3)).toBe('2027-06-20');
    expect(nthWeekday(2026, 3, 5, 1)).toBe('2026-03-06'); // first Friday of March 2026
    expect(nthWeekday(2027, 3, 5, 1)).toBe('2027-03-05');
  });
  it('fixed dates (peak is local midnight, Bahrain = UTC+3 → previous UTC day 21:00)', () => {
    const local = (y: number, k: string) => new Date(seasonalWindows(y).find((w) => w.key === k)!.peak.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
    expect(local(2026, 'uae_national_day')).toBe('2026-12-02');
    expect(local(2026, 'qatar_national_day')).toBe('2026-12-18');
    expect(local(2026, 'oman_national_day')).toBe('2026-11-20');
    expect(local(2027, 'kuwait_national_day')).toBe('2027-02-25');
    expect(local(2027, 'saudi_founding_day')).toBe('2027-02-22');
    expect(local(2027, 'coffee_day')).toBe('2027-10-01');
    expect(local(2026, 'hijri_new_year')).toBe('2026-06-16');
    expect(local(2026, 'mawlid')).toBe('2026-08-25');
    expect(peak(2026, 'fathers_day')).toBeTruthy();
  });
  it('every window has a known occasion with Arabic name, scope and a prompt', () => {
    for (const y of [2026, 2027, 2028, 2029]) for (const w of seasonalWindows(y)) {
      const o = OCCASIONS.find((x) => x.value === w.key);
      expect(o, w.key).toBeTruthy(); expect(o!.scope, w.key).toBeTruthy(); expect(o!.prompt.length).toBeGreaterThan(20);
      expect(w.from.getTime()).toBeLessThanOrEqual(w.peak.getTime()); expect(w.to.getTime()).toBeGreaterThan(w.peak.getTime() - 1);
    }
    expect(OCCASIONS.length).toBeGreaterThanOrEqual(40);
  });
  it('language / market filters and owner-disabled occasions are never picked', () => {
    const nov28 = new Date('2026-11-28T09:00:00+03:00'); // UAE day + Bahraini women day windows
    const keys = activeOccasions(nov28, { language: 'ar', market: 'BH' }).map((w) => w.key);
    expect(keys).toEqual(expect.arrayContaining(['bahraini_women_day', 'uae_national_day']));
    expect(activeOccasions(new Date('2026-12-20T09:00:00+03:00'), { language: 'ar', market: 'BH' }).map((w) => w.key)).not.toContain('christmas'); // en/ml only
    expect(activeOccasions(new Date('2026-12-20T09:00:00+03:00'), { language: 'en', market: 'BH' }).map((w) => w.key)).toContain('christmas');
    const off = ['bahraini_women_day', 'uae_national_day', 'world_childrens_day', 'oman_national_day', 'wedding_season'];
    for (let i = 0; i < 30; i++) expect(off).not.toContain(pickOccasion(nov28, { language: 'ar', market: 'BH', disabled: off }));
    expect(upcomingOccasions(new Date('2026-11-17T09:00:00+03:00'), 366).length).toBeGreaterThan(35);
  });

  it('overlapping occasions do not add up: the seasonal share stays at the strongest one', () => {
    const at = new Date('2026-12-08T09:00:00+03:00'); // national day + UAE/Qatar/Arabic day + wedding season… overlap
    let seasonal = 0; const N = 2000; let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < N; i++) if (pickOccasion(at, { language: 'ar', market: 'BH' }, rnd)) seasonal++;
    const pMax = Math.max(...activeOccasions(at, { language: 'ar', market: 'BH' }).map((w) => (w.daysToPeak >= 0 && w.daysToPeak <= 3 ? 0.8 : w.weight)));
    expect(seasonal / N).toBeLessThan(pMax + 0.05);
    expect(seasonal / N).toBeGreaterThan(pMax - 0.05);
  });
});
