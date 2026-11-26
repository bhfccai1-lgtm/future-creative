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

  it('rubric: 100 points, judged criteria clamped, brand and text MEASURED from the layers', () => {
    expect(RUBRIC.reduce((a, r) => a + r.max, 0)).toBe(100);
    const layers = [{ id: 'logo', fits: true, missing: [] }, { id: 'headline', text: 'صباحك', fits: true, missing: [] }, { id: 'cta', text: 'اطلب الآن', fits: true, missing: [] }];
    const m = { layers: layers.map((l) => ({ ...l, rect: { left: 0, top: 0, width: 1, height: 1 }, box: { x: 0, y: 0, w: 1, h: 1 } })) };
    const s = combineScore({ attention: 19, creativity: 18, image: 15, clarity: 14, share: 99 /* clamped to 10 */ }, m, 95, 'w', 'f');
    expect(s.parts).toMatchObject({ share: 10, brand: 10, text: 10 });
    expect(s.total).toBe(96); expect(s.passed).toBe(true);
    const noLogo = combineScore({ attention: 19, creativity: 18, image: 15, clarity: 14, share: 10 }, { layers: m.layers.filter((l) => l.id !== 'logo') }, 95);
    expect(noLogo.parts.brand).toBe(0); expect(noLogo.passed).toBe(false);
    const cut = combineScore({ attention: 20, creativity: 20, image: 15, clarity: 15, share: 10 }, { layers: m.layers.map((l) => (l.id === 'headline' ? { ...l, fits: false } : l)) }, 95);
    expect(cut.parts.text).toBe(5); // a clipped text layer costs the text points even if the AI loved the ad
  });
});
