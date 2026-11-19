import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AccountInput, patchSchema } from '@/lib/validation';
import { SettingsSchema } from '@/lib/settings';

describe('zod v4 upgrade guards', () => {
  it('a PATCH never fills in defaults for fields the request did not send', () => {
    const d = patchSchema(AccountInput).parse({ name: 'حساب جديد' });
    expect(d).toEqual({ name: 'حساب جديد' });
    expect('allowedProductIds' in d).toBe(false);
    expect('maxDailyAds' in d).toBe(false);
  });
  it('a PATCH still validates what it sends', () => {
    expect(() => patchSchema(AccountInput).parse({ maxDailyAds: 999 })).toThrow();
  });
  it('nested settings groups still get their inner defaults (prefault)', () => {
    const s = SettingsSchema.parse({}) as unknown as { publishing: { crossPromo: { maxPerTargetPerDay: number; delayMinutes: number } } };
    expect(s.publishing.crossPromo).toEqual({ enabled: false, maxPerTargetPerDay: 2, delayMinutes: 45 });
  });
  it('per-format records accept a partial set of keys', () => {
    expect(() => z.object({ m: AccountInput.shape.formatMix }).parse({ m: { REEL_VIDEO: 60 } })).not.toThrow();
  });
});
