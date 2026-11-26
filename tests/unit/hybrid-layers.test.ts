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

  it('contrast on ANY art: dark art → white/gold text on a navy shade, light art → navy/deep-gold text on a light veil; always ≥ 3.5:1 (QC asks 3:1)', async () => {
    const { checkContrast, contrastRatio } = await import('@/lib/qc/checks');
    const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
    const t = { headline: 'صباحك أحلى', badge: 'أكواب بالاسم', support: 'بكوب يحمل اسمك' };
    let worst = 99;
    for (const scene of [await calm(1024, 1024), await busy(1024, 1024), ...(await Promise.all(['#ffffff', '#f4ead5', '#9fd3f0', '#8a8a8a', '#000000'].map((c) => sharp({ create: { width: 1024, height: 1024, channels: 3, background: c } }).png().toBuffer())))]) {
      const c = await compose(scene, 'IMAGE_FEED', t);
      expect((await checkContrast(c.background, c.manifest)).passed).toBe(true);
      for (const id of ['headline', 'support']) {
        const l = c.manifest.layers.find((x) => x.id === id)!;
        const reg = await sharp(c.background).extract({ left: l.rect.left, top: l.rect.top, width: l.rect.width, height: l.rect.height }).png().toBuffer();
        const st = await sharp(reg).stats();
        worst = Math.min(worst, contrastRatio(hex(l.color!), [st.channels[0].mean, st.channels[1].mean, st.channels[2].mean]));
      }
    }
    expect(worst).toBeGreaterThanOrEqual(3.5);
    // the tone follows the art: cream → navy headline, navy → white headline
    const cream = await compose(await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#f4ead5' } }).png().toBuffer(), 'IMAGE_FEED', t);
    const navy = await compose(await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#14295c' } }).png().toBuffer(), 'IMAGE_FEED', t);
    expect(cream.manifest.layers.find((l) => l.id === 'headline')!.color).toBe('#0b1730');
    expect(navy.manifest.layers.find((l) => l.id === 'headline')!.color).toBe('#ffffff');
  });
});

describe('reel / story with the logo in the footer (the owner\'s sketch): a professional layout', () => {
  it('text below Instagram\'s account bar, the product zone ends above the order button, the emblem never touches a phone pill', async () => {
    const { aiPosterGeometry, headlineZone } = await import('@/lib/render/poster');
    const { IG_SAFE_1920 } = await import('@/lib/render/templates');
    const g = aiPosterGeometry(1920, false, true);
    expect(Math.round((1920 * g.topPct) / 100)).toBeGreaterThanOrEqual(IG_SAFE_1920.top); // was 3 % = 58 px, under IG's bar
    expect(headlineZone(1920, false, true).y).toBeGreaterThanOrEqual(IG_SAFE_1920.top);
    expect(Math.round(1920 * (1 - g.bottomPct / 100))).toBeLessThan(g.cta.y - 60); // product never behind the order button
    expect(g.panel.y + g.panel.h).toBeLessThanOrEqual(IG_SAFE_1920.bottom);
    for (const logoBottom of [false, true]) { const x = aiPosterGeometry(1920, false, logoBottom); expect(x.topBand + ((1920 - x.topBand) * (100 - x.bottomPct)) / 100, `logoBottom=${logoBottom}`).toBeLessThanOrEqual(x.cta.y); }
    const c = await composeAdvertisement({ scene: await calm(1024, 1536), format: 'REEL_VIDEO', lang: 'ar', templateKey: 'ai-poster', headline: '204 ركضة.. والكوب يطير؟', supportingCopy: 'هدية لعاشقة الكريكيت', badge: 'الأكواب', cta: 'اطلب الآن', logo: await logo(), contacts, typeset: { headline: '204 ركضة.. والكوب يطير؟', badge: 'الأكواب', support: 'هدية لعاشقة الكريكيت' }, logoPosition: 'bottom-center' });
    expect(checkLayout(c.manifest).filter((x) => !x.passed)).toEqual([]);
    const phone = c.manifest.layers.find((l) => l.id === 'contact:saar:phone')!;
    expect(phone.fontSize).toBeGreaterThanOrEqual(40); // was 37 with the wide logo
  });
});

describe('reels: the owner\'s contact bar (sketch) — one wide bar, big digits, large logo rising above it', () => {
  it('both branches on one navy/gold bar, digits ≥ 50 px clear of the edges, the logo centred above the bar edge, the order button above', async () => {
    const c = await composeAdvertisement({ scene: await calm(1024, 1536), format: 'REEL_VIDEO', lang: 'ar', templateKey: 'ai-poster', headline: 'قبل لا يطلع؟', supportingCopy: 'امسح وتواصل بسهولة', badge: 'بطاقات QR', cta: 'اطلب الآن', logo: await logo(), contacts, typeset: { headline: 'قبل لا يطلع؟', badge: 'بطاقات QR', support: 'امسح وتواصل بسهولة' }, logoPosition: 'bottom-center' });
    expect(checkLayout(c.manifest).filter((x) => !x.passed)).toEqual([]);
    const L = (id: string) => c.manifest.layers.find((l) => l.id === id)!;
    const { aiPosterGeometry } = await import('@/lib/render/poster');
    const g = aiPosterGeometry(1920, false, true);
    expect(g.bar).toBe(true);
    for (const k of ['saar', 'salmabad']) {
      const p = L(`contact:${k}:phone`);
      expect(p.fontSize).toBeGreaterThanOrEqual(50);
      expect(p.rect.top).toBeGreaterThan(g.panel.y); expect(p.rect.top + p.rect.height).toBeLessThan(g.panel.y + g.panel.h); // ON the bar
      expect(p.rect.left).toBeGreaterThanOrEqual(g.padX + 20); expect(p.rect.left + p.rect.width).toBeLessThanOrEqual(1080 - g.padX - 20);
    }
    const lg = L('logo').rect;
    expect(Math.abs(lg.left + lg.width / 2 - 540)).toBeLessThan(4);
    expect(lg.top).toBeLessThan(g.panel.y); // rises above the bar's top edge
    expect(L('cta').rect.top + L('cta').rect.height).toBeLessThan(lg.top); // the order button above, never touching
    expect(L('contact:saar:phone').rect.left).toBeGreaterThan(lg.left + lg.width); // Arabic: Saar right of the logo
  });
});

describe('brand features: one framed bar under the product, above the order button (owner\'s sketch)', () => {
  it('Arabic: two features in one bar, first on the right, one type size, inside the bar, above the button; the product zone ends above the bar', async () => {
    const { aiPosterGeometry } = await import('@/lib/render/poster');
    const feats = ['تصميم مخصص', 'طباعة عالية الجودة', 'تسليم سريع', 'أسعار منافسة'];
    for (const [format, w, h, H] of [['IMAGE_STORY', 1024, 1536, 1920], ['IMAGE_FEED', 1024, 1536, 1350], ['IMAGE_SQUARE', 1024, 1024, 1080]] as const) {
      const c = await compose(await calm(w, h), format, { headline: 'كوبك بتصميمك', badge: 'جديد', support: 'طباعة أكواب حسب الطلب' }, feats);
      expect(checkLayout(c.manifest).filter((x) => !x.passed).map((x) => x.detail), format).toEqual([]);
      const b = c.manifest.layers.filter((l) => l.id.startsWith('benefit:'));
      expect(b.map((l) => l.text), format).toEqual(['تصميم مخصص', 'طباعة عالية الجودة']); // the first two, like the sketch
      const g = aiPosterGeometry(H, true), st = g.strip!;
      const cta = c.manifest.layers.find((l) => l.id === 'cta')!;
      expect(st.y + st.h, format).toBeLessThan(cta.rect.top);
      for (const l of b) { expect(l.rect.top).toBeGreaterThanOrEqual(st.y); expect(l.rect.top + l.rect.height).toBeLessThanOrEqual(st.y + st.h); }
      expect(b[0].rect.left, format).toBeGreaterThan(1080 / 2); // RTL: first feature in the right cell
      expect(b[1].rect.left + b[1].rect.width, format).toBeLessThan(1080 / 2);
      expect(b[0].fontSize, format).toBe(b[1].fontSize);
      expect(b[0].fontSize!, format).toBeGreaterThanOrEqual(22);
      // the design keeps the product above the bar: the reserved bottom zone covers it
      expect(H - Math.round(((H - g.topBand) * g.bottomPct) / 100), format).toBeLessThanOrEqual(st.y);
    }
  });

  it('English: first feature on the left; no features → no bar and nothing reserved for it', async () => {
    const { aiPosterGeometry } = await import('@/lib/render/poster');
    const c = await composeAdvertisement({ scene: await calm(1024, 1536), format: 'IMAGE_FEED', lang: 'en', templateKey: 'ai-poster', headline: 'Your mug, your design', supportingCopy: 'Premium print', badge: 'New', cta: 'Order now', logo: await logo(), contacts, typeset: { headline: 'Your mug, your design', badge: 'New', support: 'Premium print' }, features: ['Custom designs', 'Fast delivery'] });
    const b = c.manifest.layers.filter((l) => l.id.startsWith('benefit:'));
    expect(b[0].rect.left + b[0].rect.width).toBeLessThan(1080 / 2);
    expect(aiPosterGeometry(1350, false).strip).toBeNull();
    expect(aiPosterGeometry(1350, false).bottomPct).toBeLessThan(aiPosterGeometry(1350, true).bottomPct);
  });
});
