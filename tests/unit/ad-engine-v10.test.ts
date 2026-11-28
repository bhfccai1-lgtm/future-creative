import { describe, expect, it } from 'vitest';
import { adStyleFor } from '@/lib/creative/ad-styles';
import { combineScore, RUBRIC, scoreBand } from '@/lib/creative/ad-score';
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

  it('Creative Quality Score (Playbook V10.0 §12): nine criteria, 100 points — seven judged, brand and technical MEASURED', () => {
    expect(RUBRIC.reduce((a, r) => a + r.max, 0)).toBe(100);
    expect(RUBRIC.map((r) => [r.key, r.max])).toEqual([['originality', 20], ['aesthetics', 15], ['attention', 15], ['composition', 10], ['harmony', 10], ['marketing', 10], ['clarity', 10], ['brand', 5], ['technical', 5]]);
    const mk = (over: Record<string, unknown> = {}) => [
      { id: 'logo', fits: true, missing: [] }, { id: 'headline', text: 'صباحك', fits: true, missing: [] }, { id: 'cta', text: 'اطلب الآن', fits: true, missing: [] },
      { id: 'contact:saar:phone', text: '33316319', fits: true, missing: [] }, { id: 'contact:salmabad:phone', text: '34315316', fits: true, missing: [] },
    ].filter((l) => over[l.id] !== null).map((l) => ({ ...l, ...(over[l.id] as object ?? {}), rect: { left: 0, top: 0, width: 1, height: 1 }, box: { x: 0, y: 0, w: 1, h: 1 } }));
    const ctx = { approvedPhones: ['33316319', '34315316'] };
    const top = { originality: 19, aesthetics: 15, attention: 14, composition: 10, harmony: 9, marketing: 10, clarity: 99 /* clamped to 10 */ };
    const s = combineScore(top, { layers: mk() }, 95, 'w', 'f', ctx, { originality: 'الكوب يطير — فكرة غير متوقعة' });
    expect(s.parts).toMatchObject({ clarity: 10, brand: 5, technical: 5 });
    expect(s.total).toBe(97); expect(s.passed).toBe(true); expect(s.reasons.originality).toMatch(/غير متوقعة/);
    expect(scoreBand(97).key).toBe('candidate'); expect(scoreBand(92).key).toBe('excellent'); expect(scoreBand(85).key).toBe('improve'); expect(scoreBand(79).key).toBe('redesign');
    // a clipped text layer costs technical points even if the art director loved the ad
    const cut = combineScore(top, { layers: mk({ headline: { fits: false } }) }, 95, '', '', ctx);
    expect(cut.parts.technical).toBe(2); expect(cut.passed).toBe(false);
    // blockers (owner's rule): never approvable whatever the total
    const wrong = combineScore(top, { layers: mk({ 'contact:saar:phone': { text: '33316318' } }) }, 95, '', '', ctx);
    expect(wrong.passed).toBe(false); expect(wrong.blocked).toMatch(/33316318/);
    const noLogo = combineScore(top, { layers: mk({ logo: null }) }, 95, '', '', ctx);
    expect(noLogo.blocked).toMatch(/الشعار/); expect(noLogo.passed).toBe(false);
    const gap = combineScore(top, { layers: mk({ headline: { missing: ['ڤ'] } }) }, 95, '', '', ctx);
    expect(gap.blocked).toMatch(/ناقص الحروف/);
  });
});
