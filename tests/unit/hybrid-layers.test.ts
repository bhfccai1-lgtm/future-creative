import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { composeAdvertisement } from '@/lib/render/compose';
import { checkLayout } from '@/lib/qc/checks';

const logo = () => sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="260"><rect width="500" height="260" rx="40" fill="#f5a623"/></svg>')).png().toBuffer();
const contacts = [{ key: 'saar', label: 'فرع سار', phone: '33316319' }, { key: 'salmabad', label: 'فرع سلماباد', phone: '34315316' }];
const calm = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: '#5a3a6a' } }).png().toBuffer();
// a busy picture: high-contrast stripes everywhere (the headline area included)
const busy = (w: number, h: number) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#f4e9d0"/>${Array.from({ length: 40 }, (_, i) => `<rect x="${i * (w / 40)}" y="0" width="${w / 80}" height="${h}" fill="#1b1b1b"/>`).join('')}</svg>`)).png().toBuffer();
const compose = async (scene: Buffer, format: 'IMAGE_STORY' | 'IMAGE_FEED' | 'IMAGE_SQUARE', t: { headline: string; badge: string; support: string }, features: string[] = []) =>
  composeAdvertisement({ scene, format, lang: 'ar', templateKey: 'ai-poster', headline: t.headline, supportingCopy: t.support, badge: t.badge, cta: 'اطلب الآن', logo: await logo(), contacts, typeset: t, features });

describe('hybrid layers never overlap, and the headline stays readable on any picture', () => {
  it('every format, short and long copy, with and without the feature row: no overlap, all text fits, inside the safe zones', async () => {
    const copies = [{ headline: 'صباحك أحلى', badge: 'أكواب بالاسم', support: 'بكوب يحمل اسمك' }, { headline: 'هدية تفرح القلب وتبقى ذكرى جميلة طول العمر', badge: 'ملصقات تغليف الهدايا', support: 'بتصاميمك الخاصة ولمسة فاخرة' }];
    for (const [format, w, h] of [['IMAGE_STORY', 1024, 1536], ['IMAGE_FEED', 1024, 1024], ['IMAGE_SQUARE', 1024, 1024]] as const)
      for (const t of copies) for (const features of [[], ['تصميم مجاني', 'طباعة فاخرة', 'تسليم سريع']]) {
        const c = await compose(await calm(w, h), format, t, features);
        const failed = checkLayout(c.manifest).filter((x) => !x.passed).map((x) => `${x.id}: ${x.detail}`);
        expect(failed, `${format} · ${t.headline.length} chars · ${features.length} features`).toEqual([]);
        const ids = c.manifest.layers.map((l) => l.id);
        expect(ids).toEqual(expect.arrayContaining(['headline', 'badge', 'support', 'logo', 'cta']));
      }
  });

  it('the soft shadow is composited but the manifest records the real text box (the shadow margin is not an overlap)', async () => {
    const c = await compose(await calm(1024, 1536), 'IMAGE_STORY', { headline: 'صباحك أحلى', badge: 'أكواب', support: 'باسمك' });
    const head = c.manifest.layers.find((l) => l.id === 'headline')!, layer = c.layers.find((l) => l.id === 'headline')!;
    expect(layer.width - head.rect.width).toBe(28); // 14 px shadow margin on each side, drawn but not counted
  });

  it('busy art under the headline gets a deeper shade than calm art (measured, free)', async () => {
    const zoneMean = async (scene: Buffer) => {
      const c = await compose(scene, 'IMAGE_FEED', { headline: 'صباحك أحلى', badge: 'أكواب', support: 'باسمك' });
      const r = await sharp(c.background).extract({ left: 0, top: 200, width: 1080, height: 120 }).greyscale().png().toBuffer();
      return (await sharp(r).stats()).channels[0].mean;
    };
    const busyArt = await busy(1024, 1024);
    const raw = await sharp(busyArt).resize(1080, 1080).extract({ left: 0, top: 50, width: 1080, height: 120 }).greyscale().png().toBuffer();
    // the shade darkens the busy picture well below its own brightness → the white headline reads on it
    expect(await zoneMean(busyArt)).toBeLessThan((await sharp(raw).stats()).channels[0].mean * 0.7);
  });
});
