import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { composeAdvertisement } from '@/lib/render/compose';
import { renderCarousel, normaliseSlides, FALLBACK_SLIDES } from '@/lib/render/carousel';
import { DryRunProvider } from '@/lib/ai/dry-run-provider';
import type { Lang } from '@/lib/render/fonts';

const contacts = { ar: ['فرع سار', 'فرع سلماباد'], en: ['Saar branch', 'Salmabad branch'], ml: ['സാർ ബ്രാഞ്ച്', 'സൽമാബാദ് ബ്രാഞ്ച്'] };

describe('Instagram carousel renderer', () => {
  it.each(['ar', 'en', 'ml'] as Lang[])('renders readable 1080×1350 JPEG slides with both branch numbers (%s)', async (lang) => {
    const scene = (await new DryRunProvider().generateScene('', { size: '1024x1536', seedHint: `c-${lang}` })).png;
    const logo = await sharp({ create: { width: 500, height: 200, channels: 4, background: '#d4af37' } }).png().toBuffer();
    const c = await composeAdvertisement({ scene, format: 'IMAGE_CAROUSEL', lang, headline: lang === 'ar' ? 'دفاتر القراءة' : 'Reading logs', supportingCopy: '—', cta: lang === 'ar' ? 'اطلب الآن' : 'Order Now', logo, contacts: [{ key: 'saar', label: contacts[lang][0], phone: '33316319' }, { key: 'salmabad', label: contacts[lang][1], phone: '34315316' }] });
    expect([c.width, c.height]).toEqual([1080, 1350]);
    const r = await renderCarousel(c, scene, FALLBACK_SLIDES[lang], lang);
    expect(r.problems).toEqual([]);
    expect(r.slides).toHaveLength(4); // 3 content + final CTA (cover is the composed design)
    for (const s of r.slides) expect(await sharp(s).metadata()).toMatchObject({ width: 1080, height: 1350, format: 'jpeg' });
  }, 120_000);
  it('tops up to 3 slides with truthful generic slides and caps at 4', () => {
    expect(normaliseSlides([{ title: 'a', body: 'b' }], 'ar')).toHaveLength(3);
    expect(normaliseSlides(Array.from({ length: 6 }, (_, i) => ({ title: `t${i}`, body: 'b' })), 'en')).toHaveLength(4);
    expect(normaliseSlides(undefined, 'ml')).toEqual(FALLBACK_SLIDES.ml);
    expect(JSON.stringify(FALLBACK_SLIDES)).not.toMatch(/\d+\s*(د\.ب|BHD|دينار|%|ساعة|يوم)/); // no prices/discounts/times
  });
});
