import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { renderText } from '@/lib/render/text';
import { missingGlyphs } from '@/lib/render/fonts';
import { composeAdvertisement, toJpeg } from '@/lib/render/compose';
import { checkLogoPixels, checkContrast, checkLayout } from '@/lib/qc/checks';
import { DryRunProvider } from '@/lib/ai/dry-run-provider';

const logoPng = () => sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><circle cx="150" cy="150" r="120" fill="#d4af37"/><rect x="300" y="90" width="260" height="120" rx="20" fill="#0b1730"/></svg>')).png().toBuffer();
const contacts = [{ key: 'saar', label: 'فرع سار', phone: '33316319' }, { key: 'salmabad', label: 'فرع سلماباد', phone: '34315316' }];

describe('Arabic text rendering', () => {
  it('shapes Arabic text with the embedded font and fits the box', async () => {
    const r = await renderText({ text: 'ملصقات تبرز علامتك التجارية', lang: 'ar', weight: 'extrabold', color: '#ffffff', maxSize: 92, minSize: 50, boxW: 950, boxH: 260, maxLines: 2 });
    expect(r.fits).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.width).toBeLessThanOrEqual(950);
    // Contextual shaping makes the joined word much narrower than its isolated letters.
    const joined = await renderText({ text: 'ملصقات', lang: 'ar', weight: 'bold', color: '#fff', maxSize: 60, minSize: 60, boxW: 2000, boxH: 400 });
    const isolated = await renderText({ text: 'م ل ص ق ا ت', lang: 'ar', weight: 'bold', color: '#fff', maxSize: 60, minSize: 60, boxW: 2000, boxH: 400 });
    expect(joined.width).toBeLessThan(isolated.width * 0.75);
  });
  it('shrinks long headlines and reports overflow honestly when impossible', async () => {
    const long = 'طباعة احترافية لجميع أنواع الملصقات والليبلات والعبوات والهدايا والبنرات والكتالوجات '.repeat(3);
    const r = await renderText({ text: long, lang: 'ar', weight: 'extrabold', color: '#fff', maxSize: 90, minSize: 50, boxW: 900, boxH: 200, maxLines: 2 });
    expect(r.fits).toBe(false);
  });
  it('detects characters missing from the font', () => {
    expect(missingGlyphs('اطلب الآن', 'ar')).toEqual([]);
    expect(missingGlyphs('ഇപ്പോൾ', 'ml')).toEqual([]);
    expect(missingGlyphs('印刷', 'ar')).toEqual(['印', '刷']);
  });
});

describe('layered advertisement composition', () => {
  it('produces a 1080x1920 design with logo, headline, CTA and both phone numbers as separate layers', async () => {
    const scene = (await new DryRunProvider().generateScene('', { size: '1024x1536', seedHint: 'unit' })).png;
    const logo = await logoPng();
    const c = await composeAdvertisement({ scene, format: 'IMAGE_STORY', lang: 'ar', headline: 'اطبع فكرتك بإبداع', supportingCopy: 'ملصقات تبرز علامتك التجارية', cta: 'اطلب الآن', logo, contacts });
    expect([c.width, c.height]).toEqual([1080, 1920]);
    const ids = c.manifest.layers.map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(['headline', 'support', 'logo', 'cta', 'contact:saar:phone', 'contact:salmabad:phone', 'contact:saar:label']));
    expect(c.manifest.layers.find((l) => l.id === 'contact:saar:phone')?.text).toBe('33316319');
    expect(c.manifest.layers.find((l) => l.id === 'contact:salmabad:phone')?.text).toBe('34315316');
    // Arabic: first location (Saar) is placed on the right
    const saar = c.manifest.layers.find((l) => l.id === 'contact:saar:phone')!.rect.left;
    const salm = c.manifest.layers.find((l) => l.id === 'contact:salmabad:phone')!.rect.left;
    expect(saar).toBeGreaterThan(salm);
    expect(checkLayout(c.manifest).every((x) => x.passed)).toBe(true);
    expect((await checkContrast(c.background, c.manifest)).passed).toBe(true);

    const jpeg = await toJpeg(c.png);
    const meta = await sharp(jpeg).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 1080, 1920]);

    const logoLayer = c.layers.find((l) => l.id === 'logo')!;
    const ok = await checkLogoPixels(jpeg, c.background, logoLayer.png, c.manifest.layers.find((l) => l.id === 'logo')!.rect);
    expect(ok.passed).toBe(true);
    // Logo aspect ratio is preserved (2:1 source)
    expect(Math.abs(logoLayer.width / logoLayer.height - 2)).toBeLessThan(0.02);

    // A recoloured logo in the output must be detected
    const tampered = await sharp(jpeg).composite([{ input: await sharp(logoLayer.png).negate({ alpha: false }).png().toBuffer(), left: logoLayer.left, top: logoLayer.top }]).jpeg().toBuffer();
    const bad = await checkLogoPixels(tampered, c.background, logoLayer.png, c.manifest.layers.find((l) => l.id === 'logo')!.rect);
    expect(bad.passed).toBe(false);
  });

  it('renders English and Malayalam variants with correct glyph coverage', async () => {
    const scene = (await new DryRunProvider().generateScene('', { size: '1024x1536', seedHint: 'ml' })).png;
    const logo = await logoPng();
    for (const [lang, h, cta] of [['en', 'Your Brand, Printed Right', 'Order Now'], ['ml', 'ഗുണമേന്മയുള്ള പ്രിന്റിംഗ്', 'ഇപ്പോൾ ഓർഡർ ചെയ്യൂ']] as const) {
      const c = await composeAdvertisement({ scene, format: 'IMAGE_FEED', lang, headline: h, supportingCopy: null, cta, logo, contacts: [{ key: 'saar', label: 'Saar', phone: '33316319' }, { key: 'salmabad', label: 'Salmabad', phone: '34315316' }] });
      expect([c.width, c.height]).toEqual([1080, 1350]);
      expect(c.manifest.layers.every((l) => l.missing.length === 0)).toBe(true);
      expect(c.manifest.layers.every((l) => l.fits)).toBe(true);
    }
  });
});

describe('full AI poster on every format', () => {
  for (const [format, h, size] of [['IMAGE_STORY', 1920, '1024x1536'], ['IMAGE_FEED', 1350, '1024x1024'], ['IMAGE_CAROUSEL', 1350, '1024x1024'], ['IMAGE_SQUARE', 1080, '1024x1024']] as const) {
    it(`${format}: whole AI design + official logo, CTA and both phones in the verified band (${h}px)`, async () => {
      const { aiPosterImageSize, aiPosterGeometry } = await import('@/lib/render/poster');
      expect(aiPosterImageSize(h)).toBe(size);
      const scene = (await new DryRunProvider().generateScene('', { size, seedHint: 'ai-' + format })).png;
      const c = await composeAdvertisement({ scene, format, templateKey: 'ai-poster', lang: 'ar', headline: 'اطبع فكرتك بإبداع', supportingCopy: null, cta: 'اطلب الآن', logo: await logoPng(), contacts });
      expect([c.width, c.height]).toEqual([1080, h]);
      expect(c.templateKey).toBe('ai-poster');
      const g = aiPosterGeometry(h);
      const byId = (id: string) => c.manifest.layers.find((l) => l.id === id);
      expect(byId('contact:saar:phone')?.text).toBe('33316319');
      expect(byId('contact:salmabad:phone')?.text).toBe('34315316');
      // the logo sits in the empty top zone of the design; CTA and phones inside the band, never on the AI art
      expect(byId('logo')!.rect.top + byId('logo')!.rect.height).toBeLessThanOrEqual(Math.round(g.artH * 0.15));
      for (const id of ['cta', 'contact:saar:phone', 'contact:salmabad:phone']) {
        expect(byId(id)!.rect.top).toBeGreaterThanOrEqual(g.artH);
        expect(byId(id)!.rect.top + byId(id)!.rect.height).toBeLessThanOrEqual(h);
      }
      expect(checkLayout(c.manifest).every((x) => x.passed)).toBe(true);
    });
  }
});

