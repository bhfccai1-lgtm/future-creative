import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { findClaims, findWrongPhones, lintText, checkLanguage, checkLayout, contrastRatio, scriptRatio } from '@/lib/qc/checks';
import { normalizeText, similarity, ideaFingerprint } from '@/lib/dedup/text';
import { phash, hamming } from '@/lib/dedup/phash';
import type { LayerManifest } from '@/lib/render/compose';

describe('unverifiable claims detection', () => {
  it('flags prices, discounts, delivery times and superlatives', () => {
    expect(findClaims('خصم 50% على الملصقات')).not.toHaveLength(0);
    expect(findClaims('بسعر 5 دينار فقط')).not.toHaveLength(0);
    expect(findClaims('التسليم خلال 24 ساعة')).not.toHaveLength(0);
    expect(findClaims('Free delivery, best in Bahrain')).not.toHaveLength(0);
    expect(findClaims('BHD 3 per box')).not.toHaveLength(0);
  });
  it('accepts clean brand copy', () => {
    expect(findClaims('ملصقات تبرز علامتك التجارية')).toHaveLength(0);
    expect(findClaims('A mug printed with your own design')).toHaveLength(0);
  });
});

describe('phone number validation', () => {
  const approved = ['33316319', '34315316'];
  it('allows only the approved business numbers', () => {
    expect(findWrongPhones('اتصل 33316319', approved)).toEqual([]);
    expect(findWrongPhones('Call +973 3431 5316', approved)).toEqual([]);
    expect(findWrongPhones('اتصل على 39999999', approved)).toEqual(['39999999']);
    expect(findWrongPhones('٣٣٣١٦٣١٩', approved)).toEqual([]); // Arabic-Indic digits normalised
  });
});

describe('language / script checks', () => {
  it('detects wrong-language copy', () => {
    expect(scriptRatio('اطلب الآن', 'ar')).toBe(1);
    expect(checkLanguage(['اطلب الآن', 'طباعة الملصقات'], 'ar').passed).toBe(true);
    expect(checkLanguage(['Order now'], 'ar').passed).toBe(false);
    expect(checkLanguage(['ഇപ്പോൾ ഓർഡർ ചെയ്യൂ'], 'ml').passed).toBe(true);
    expect(checkLanguage(['اطلب'], 'en').passed).toBe(false);
  });
  it('lints typographic errors', () => {
    expect(lintText('طباعة  الملصقات', 'ar')).toContain('مسافات مزدوجة');
    expect(lintText('طباعة طباعة الملصقات', 'ar')).toContain('كلمة مكررة متتالية');
    expect(lintText('هل تريد طباعة?', 'ar').length).toBeGreaterThan(0);
    expect(lintText('اطبع فكرتك بإبداع', 'ar')).toEqual([]);
  });
});

describe('layout geometry checks', () => {
  const base: LayerManifest = { width: 1080, height: 1920, templateKey: 't', lang: 'ar', layers: [
    { id: 'headline', rect: { left: 100, top: 200, width: 800, height: 150 }, box: { x: 0, y: 0, w: 0, h: 0 }, fits: true, missing: [] },
    { id: 'logo', rect: { left: 400, top: 50, width: 280, height: 120 }, box: { x: 0, y: 0, w: 0, h: 0 }, fits: true, missing: [] },
  ] };
  it('passes a clean layout', () => { expect(checkLayout(base).every((c) => c.passed)).toBe(true); });
  it('detects overlap, overflow, missing glyphs and unsafe placement', () => {
    const bad: LayerManifest = { ...base, layers: [
      { ...base.layers[0], fits: false, missing: ['☃'] },
      { ...base.layers[1], rect: { left: 150, top: 250, width: 300, height: 100 } },
      { id: 'cta', rect: { left: 1000, top: 1900, width: 200, height: 60 }, box: { x: 0, y: 0, w: 0, h: 0 }, fits: true, missing: [] },
    ] };
    const r = Object.fromEntries(checkLayout(bad).map((c) => [c.id, c.passed]));
    expect(r).toEqual({ text_fit: false, glyphs: false, no_overlap: false, safe_area: false });
  });
  it('computes WCAG contrast', () => {
    expect(contrastRatio([255, 255, 255], [11, 23, 48])).toBeGreaterThan(15);
    expect(contrastRatio([200, 200, 200], [210, 210, 210])).toBeLessThan(1.2);
  });
});

describe('duplicate detection primitives', () => {
  it('normalises Arabic variants', () => {
    expect(normalizeText('إطبع فكرتك بإبداعٍ!')).toBe(normalizeText('اطبع فكرتك بابداع'));
  });
  it('scores paraphrases high and different concepts low', () => {
    expect(similarity('Ceramic mug as a gift for mother', 'ceramic mug gift for mother')).toBeGreaterThan(0.75);
    expect(similarity('Ceramic mug as a gift for mother', 'roll-up banner at an exhibition hall')).toBeLessThan(0.3);
    const a = ideaFingerprint('ceramic-mugs', 'Morning coffee ritual with personalised mug', 'mug-morning-ritual');
    expect(a.startsWith('ceramic-mugs::')).toBe(true);
  });
  it('perceptual hash: re-encoded / resized copies are close, different scenes far', async () => {
    const { DryRunProvider } = await import('@/lib/ai/dry-run-provider');
    const d = new DryRunProvider();
    const img = (await d.generateScene('', { size: '1024x1536', seedHint: 'one' })).png;
    const other = (await d.generateScene('', { size: '1024x1536', seedHint: 'two' })).png;
    const jpegAgain = await sharp(img).jpeg({ quality: 70 }).toBuffer();
    const resized = await sharp(img).resize(540).jpeg({ quality: 80 }).toBuffer();
    const [h1, h2, h3, h4] = await Promise.all([phash(img), phash(jpegAgain), phash(other), phash(resized)]);
    expect(hamming(h1, h2)).toBeLessThanOrEqual(6); // PHASH_DUP_DISTANCE
    expect(hamming(h1, h4)).toBeLessThanOrEqual(6);
    expect(hamming(h1, h3)).toBeGreaterThan(10);
  });
});
