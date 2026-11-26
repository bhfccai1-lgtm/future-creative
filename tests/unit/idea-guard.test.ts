import { describe, expect, it } from 'vitest';
import { ideaGuard } from '@/lib/creative/idea-guard';

describe('idea guard: no prices, discounts or delivery times in an ad idea (owner\'s rule)', () => {
  it('flags each kind, in Arabic and English', () => {
    expect(ideaGuard('كوب العائلة بسعر 3 دينار فقط')).toHaveLength(1);
    expect(ideaGuard('كوب بـ 2.5 د.ب')[0]).toContain('سعر');
    expect(ideaGuard('خصم 20% على الأكواب')[0]).toContain('خصم');
    expect(ideaGuard('تخفيضات العيد')).toHaveLength(1);
    expect(ideaGuard('جاهز خلال 24 ساعة')[0]).toContain('مدة تسليم');
    expect(ideaGuard('طباعة نفس اليوم')).toHaveLength(1);
    expect(ideaGuard('mugs 50% off, ready within 2 days')).toHaveLength(2);
    expect(ideaGuard('only BD 5')).toHaveLength(1);
  });
  it('lets ordinary ideas through (numbers that are not prices or times included)', () => {
    for (const ok of ['', 'كوب مطبوع بصورة العائلة على طاولة إفطار رمضاني', 'ثلاث أفكار لهدية التخرج', 'طقم 4 أكواب للعائلة', 'Family mug for Mother\'s Day', 'ملصقات بمقاس 10 سم'])
      expect(ideaGuard(ok), ok).toEqual([]);
  });
});

describe('content languages offered in the create and campaign forms', () => {
  it('include Hindi (the API, the Language enum and the renderer already support it)', async () => {
    const { LANGUAGES } = await import('@/lib/creative/options');
    expect(LANGUAGES.map((l) => l.value)).toEqual(['ar', 'en', 'ml', 'hi']);
    expect(LANGUAGES.find((l) => l.value === 'hi')?.ar).toBe('الهندية');
  });
});
