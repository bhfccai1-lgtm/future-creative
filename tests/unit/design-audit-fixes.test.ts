import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { composeAdvertisement } from '@/lib/render/compose';
import { checkLayout } from '@/lib/qc/checks';
import { renderText, typesettable } from '@/lib/render/text';

const logo = () => sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="260"><rect width="500" height="260" rx="40" fill="#f5a623"/></svg>')).png().toBuffer();
const scene = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: '#1d2a44' } }).png().toBuffer();

describe('design audit fixes', () => {
  it('emoji and unsupported symbols are never typeset (they rendered as empty boxes and failed the glyph check)', async () => {
    expect(typesettable('هدية 🎁 ✨ تفرح القلب')).toBe('هدية تفرح القلب');
    expect(typesettable('👨‍👩‍👧 عائلة')).toBe('عائلة');
    expect(typesettable('🇧🇭 البحرين')).toBe('البحرين');
    expect(typesettable('Café — naïve ✓ 50%')).toBe('Café — naïve 50%');
    expect(typesettable('नमस्ते, कैसे हो?')).toBe('नमस्ते, कैसे हो?'); // Devanagari marks are letters, not symbols
    const t = await renderText({ text: 'صباحك أحلى ☕✨', lang: 'ar', weight: 'bold', color: '#fff', maxSize: 40, minSize: 20, boxW: 600, boxH: 80, maxLines: 1 });
    expect(t.missing).toEqual([]);
  });

  it('the order pill grows with a long CTA (Malayalam in the square format) instead of overflowing', async () => {
    const c = await composeAdvertisement({ scene: await scene(1024, 1024), format: 'IMAGE_SQUARE', lang: 'ml', templateKey: 'ai-poster', headline: 'നിങ്ങളുടെ പേരിൽ മഗ്', supportingCopy: 'നിങ്ങൾക്കായി പ്രിന്റ്', badge: 'കസ്റ്റം മഗ്', cta: 'ഇപ്പോൾ ഓർഡർ ചെയ്യൂ', logo: await logo(),
      contacts: [{ key: 'saar', label: 'സാർ', phone: '33316319' }, { key: 'salmabad', label: 'സൽമാബാദ്', phone: '34315316' }], typeset: { headline: 'നിങ്ങളുടെ പേരിൽ മഗ്', badge: 'കസ്റ്റം മഗ്', support: 'നിങ്ങൾക്കായി പ്രിന്റ്' } });
    expect(checkLayout(c.manifest).filter((x) => !x.passed)).toEqual([]);
    const cta = c.manifest.layers.find((l) => l.id === 'cta')!;
    expect(cta.fits).toBe(true);
    expect(cta.rect.left).toBeGreaterThanOrEqual(0);
    expect(cta.rect.left + cta.rect.width).toBeLessThanOrEqual(1080);
  });

  it('a short CTA keeps the designed pill width (no growth when it fits)', async () => {
    const c = await composeAdvertisement({ scene: await scene(1024, 1024), format: 'IMAGE_SQUARE', lang: 'ar', templateKey: 'ai-poster', headline: 'صباحك أحلى', supportingCopy: 'بكوب يحمل اسمك', badge: 'أكواب', cta: 'اطلب الآن', logo: await logo(),
      contacts: [{ key: 'saar', label: 'فرع سار', phone: '33316319' }], typeset: { headline: 'صباحك أحلى', badge: 'أكواب', support: 'بكوب يحمل اسمك' } });
    expect(c.manifest.layers.find((l) => l.id === 'cta')!.rect.width).toBe(500 + 140); // the 500 px square pill + its rays
  });
});

describe('light designs stay light (no muddy grey band, seam or side strips)', () => {
  const light = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: '#f6efe1' } }).png().toBuffer();
  const region = async (png: Buffer, left: number, top: number, width: number, height: number) =>
    (await sharp(await sharp(png).extract({ left, top, width, height }).greyscale().png().toBuffer()).stats()).channels[0]; // stats() ignores extract()
  const make = async (format: 'IMAGE_FEED' | 'IMAGE_SQUARE', bg: (w: number, h: number) => Promise<Buffer>, h: number) => composeAdvertisement({ scene: await bg(1024, h), format, lang: 'en', templateKey: 'ai-poster', headline: 'Your mug', supportingCopy: 'Printed for you', badge: 'Mugs', cta: 'Order now', logo: await logo(),
    contacts: [{ key: 'saar', label: 'Saar', phone: '33316319' }], typeset: { headline: 'Your mug', badge: 'Mugs', support: 'Printed for you' } });

  it('feed: the logo band continues a light design (was darkened to a grey strip) and meets it without a seam', async () => {
    const c = await make('IMAGE_FEED', light, 1536);
    const band = await region(c.background, 0, 0, 160, 140); // left of the logo
    expect(band.mean).toBeGreaterThan(200);
    const seam = await region(c.background, 0, 150, 1080, 120); // where the band meets the art
    expect(seam.min).toBeGreaterThan(180); // no dark line
  });
  it('square: the side margins of a light design are not grey', async () => {
    const c = await make('IMAGE_SQUARE', light, 1024);
    const side = await region(c.background, 0, 400, 40, 120), centre = await region(c.background, 520, 400, 40, 120);
    expect(centre.mean - side.mean).toBeLessThan(12);
  });
  it('dark designs keep their deep band (the darkening still applies to dark art)', async () => {
    const c = await make('IMAGE_FEED', scene, 1536);
    expect((await region(c.background, 0, 0, 160, 140)).mean).toBeLessThan(60);
  });
});
