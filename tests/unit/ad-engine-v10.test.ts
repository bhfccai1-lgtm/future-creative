import { describe, expect, it } from 'vitest';
import { adStyleFor } from '@/lib/creative/ad-styles';
import { combineScore, RUBRIC } from '@/lib/creative/ad-score';
import { fullPosterPrompt } from '@/lib/ai/prompts';

describe('V10 engine: style by product, the golden rule prompt, the 100-point rubric', () => {
  it('the owner\'s table: the product decides the ad style (its own words first, then its category)', () => {
    expect(adStyleFor({ slug: 'ceramic-mugs', titleAr: 'أكواب سيراميك' })?.ar).toBe('فكاهي، إبداعي، ثلاثي الأبعاد');
    expect(adStyleFor({ slug: 'wedding-invitations' })?.ar).toBe('فاخر، ذهبي، أنيق');
    expect(adStyleFor({ slug: 'business-cards' })?.key).toBe('business-cards');
    expect(adStyleFor({ slug: 'rubber-stamps', titleAr: 'أختام' })?.key).toBe('stamps');
    expect(adStyleFor({ slug: 'x', titleAr: 'مسكات تصوير للحفلات' })?.key).toBe('photo-props');
    expect(adStyleFor({ slug: 'thing', categorySlug: 'events-weddings' })?.key).toBe('wedding'); // category fallback
    expect(adStyleFor({ slug: 'flyers', categorySlug: 'print-marketing' })).toBeNull(); // no rule → the general direction
  });

  it('golden rule prompt: the design is text-free with a calm headline area; the drawn-text instructions are gone', () => {
    const base = { lang: 'ar' as const, headline: 'صباحك أحلى', badge: 'أكواب', support: 'باسمك', features: ['تصميم مجاني'], sceneDescription: 'a mug', style: 'premium' };
    const hybrid = fullPosterPrompt({ ...base, textless: { headlinePct: 18 } });
    expect(hybrid).toMatch(/TEXT-FREE DESIGN/);
    expect(hybrid).toMatch(/upper 18% of the poster/);
    expect(hybrid).not.toMatch(/kicker line|صباحك أحلى|render EXACTLY/);
    expect(fullPosterPrompt(base)).toMatch(/kicker line near the top: "صباحك أحلى"/); // the drawn-text mode is unchanged
  });

  it('«مؤشر الخوارزمية» (spec §6): 100 points — hook/clarity/format/value judged, action and execution MEASURED', () => {
    expect(RUBRIC.reduce((a, r) => a + r.max, 0)).toBe(100);
    const mk = (over: Record<string, unknown> = {}) => [
      { id: 'logo', fits: true, missing: [] }, { id: 'headline', text: 'صباحك', fits: true, missing: [] }, { id: 'cta', text: 'اطلب الآن', fits: true, missing: [] },
      { id: 'contact:saar:phone', text: '33316319', fits: true, missing: [] }, { id: 'contact:salmabad:phone', text: '34315316', fits: true, missing: [] },
    ].map((l) => ({ ...l, ...(over[l.id] as object ?? {}), rect: { left: 0, top: 0, width: 1, height: 1 }, box: { x: 0, y: 0, w: 1, h: 1 } }));
    const ctx = { approvedPhones: ['33316319', '34315316'], caption: 'اطلب الآن عبر واتساب' };
    const s = combineScore({ hook: 19, clarity: 18, format: 15, value: 99 /* clamped to 15 */ }, { layers: mk() }, 95, 'w', 'f', ctx, { hook: 'الكوب يطير — يوقف التمرير' });
    expect(s.parts).toMatchObject({ value: 15, action: 15, execution: 15 });
    expect(s.total).toBe(97); expect(s.passed).toBe(true); expect(s.reasons.hook).toMatch(/يوقف/);
    const noCta = combineScore({ hook: 19, clarity: 18, format: 15, value: 15 }, { layers: mk() }, 95, '', '', { ...ctx, caption: 'كوب جميل' });
    expect(noCta.parts.action).toBe(10); expect(noCta.passed).toBe(false); // no call to action in the caption
    const cut = combineScore({ hook: 20, clarity: 20, format: 15, value: 15 }, { layers: mk({ headline: { fits: false } }) }, 95, '', '', ctx);
    expect(cut.parts.execution).toBe(11); // a clipped text layer costs execution points even if the AI loved the ad
    // a wrong number: never approvable, whatever the total (owner's rule)
    const wrong = combineScore({ hook: 20, clarity: 20, format: 15, value: 15 }, { layers: mk({ 'contact:saar:phone': { text: '33316318' } }) }, 95, '', '', ctx);
    expect(wrong.passed).toBe(false); expect(wrong.blocked).toMatch(/33316318/);
  });
});
