import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { buildBackground, composeAdvertisement, THEMES, type ThemeKey } from '@/lib/render/compose';
import { checkContrast, checkLayout } from '@/lib/qc/checks';
import { DryRunProvider } from '@/lib/ai/dry-run-provider';
import { renderReel } from '@/lib/video/reel';
import { run } from '@/lib/video/probe';
import { MetricoolAdapter } from '@/lib/publishing/metricool';
import { targetNetworks, unavailableChannels } from '@/lib/publishing/publisher';
import { proSceneCount } from '@/lib/creative/options';

const contacts = [{ key: 'saar', label: 'فرع سار', phone: '33316319' }, { key: 'salmabad', label: 'فرع سلماباد', phone: '34315316' }];
const logo = () => sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="240"><circle cx="120" cy="120" r="100" fill="#d4af37"/></svg>')).png().toBuffer();
const scene = (seed: string) => new DryRunProvider().generateScene('', { size: '1024x1536', seedHint: seed }).then((r) => r.png);

describe('design styles (layout themes)', () => {
  it('every theme passes layout and contrast QC in both templates', async () => {
    const [sc, lg] = await Promise.all([scene('t'), logo()]);
    for (const theme of Object.keys(THEMES) as ThemeKey[]) for (const templateKey of ['navy-gold-classic', 'gold-frame-lower']) {
      const c = await composeAdvertisement({ scene: sc, format: 'IMAGE_STORY', lang: 'ar', theme, templateKey, headline: 'نحتفل بالعيد الوطني', supportingCopy: 'هدايا شركات تحمل هويتكم', cta: 'اطلب الآن', logo: lg, contacts });
      expect(checkLayout(c.manifest).every((x) => x.passed), `${theme}/${templateKey} layout`).toBe(true);
      const cr = await checkContrast(c.background, c.manifest);
      expect(cr.passed, `${theme}/${templateKey}: ${cr.detail}`).toBe(true);
      expect(c.themeKey).toBe(theme);
    }
  }, 120_000);
  it('contrast QC measures the region behind each text (regression: sharp stats() ignored extract)', async () => {
    const lg = await logo();
    const white = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: '#ffffff' } }).png().toBuffer();
    // dark-on-dark: navy text colours on a black scene must be rejected, not averaged away
    const c = await composeAdvertisement({ scene: white, format: 'IMAGE_STORY', lang: 'ar', theme: 'white_minimal', headline: 'عنوان', supportingCopy: 'نص', cta: 'اطلب الآن', logo: lg, contacts });
    const tampered = await sharp(c.background).composite([{ input: { create: { width: 1080, height: 700, channels: 3, background: '#000000' } }, left: 0, top: 0 }]).png().toBuffer();
    expect((await checkContrast(tampered, c.manifest)).passed).toBe(false);
  });
});

describe('pro reels & audio', () => {
  it('pro reel: several AI scenes with transitions + royalty-free music track', async () => {
    const lg = await logo();
    const [a, b, c2] = await Promise.all([scene('p1'), scene('p2'), scene('p3')]);
    const c = await composeAdvertisement({ scene: a, format: 'REEL_VIDEO', lang: 'ar', theme: 'black_gold', headline: 'هدايا العيد', supportingCopy: 'بتصميمك', cta: 'اطلب الآن', logo: lg, contacts });
    const extra = await Promise.all([b, c2].map((x) => buildBackground(x, 'REEL_VIDEO', c.templateKey, 2, 'black_gold')));
    const r = await renderReel(c, 10, { extraBackgrounds: extra, audio: 'ambient' });
    expect(r.scenes).toBe(3);
    expect(r.probe.valid).toBe(true);
    expect(Math.abs(r.probe.durationSec - 10)).toBeLessThan(0.2);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-pro-')); const f = path.join(dir, 'r.mp4'); await fs.writeFile(f, r.mp4);
    const vol = await run('ffmpeg', ['-hide_banner', '-i', f, '-af', 'volumedetect', '-vn', '-f', 'null', '-']);
    const mean = Number(/mean_volume: (-?[\d.]+) dB/.exec(vol.stderr)?.[1]);
    expect(mean).toBeGreaterThan(-40); // audible, not silent
    // scene 1 and the last scene really differ (multi-scene, not a single still)
    for (const t of ['1.5', '6.2']) await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', t, '-i', f, '-frames:v', '1', path.join(dir, `${t}.png`)]);
    const [x, y] = await Promise.all(['1.5', '6.2'].map((t) => sharp(path.join(dir, `${t}.png`)).resize(108, 192).raw().toBuffer()));
    let diff = 0; for (let i = 0; i < x.length; i++) diff += Math.abs(x[i] - y[i]);
    expect(diff / x.length).toBeGreaterThan(8);
    await fs.rm(dir, { recursive: true, force: true });
  }, 240_000);
  it('scene count grows with reel duration', () => {
    expect([7, 10, 15, 20, 30].map(proSceneCount)).toEqual([2, 2, 3, 3, 4]);
  });
});

describe('publishing channels', () => {
  const a = new MetricoolAdapter({ token: 't', userId: '1', baseUrl: 'https://x', fetchImpl: fetch });
  const req = { idempotencyKey: 'k', providerBrandId: '1', networks: ['instagram', 'facebook', 'tiktok'] as const, format: 'REEL_VIDEO' as const, publishAt: new Date('2026-12-16T15:00:00Z'), timezone: 'Asia/Bahrain', text: 'x', mediaUrls: ['https://m/v.mp4'], aiGenerated: true, instagramAudio: 'Khaleeji beat' };
  it('one Metricool post targets every chosen network with its own settings', () => {
    const b = a.buildBody({ ...req, networks: [...req.networks] }) as Record<string, Record<string, unknown>>;
    expect(b.providers).toEqual([{ network: 'instagram' }, { network: 'facebook' }, { network: 'tiktok' }]);
    expect(b.instagramData).toMatchObject({ type: 'REEL', audioConfiguration: { audioId: 'Khaleeji beat' } });
    expect(b.facebookData).toMatchObject({ type: 'REEL' });
    expect(b.tiktokData).toMatchObject({ isAigc: true });
  });
  it('targets the account platform by default and validates channels against the brand', () => {
    expect(targetNetworks('instagram', [])).toEqual(['instagram']);
    expect(targetNetworks('instagram', ['facebook', 'instagram'])).toEqual(['instagram', 'facebook']);
    expect(unavailableChannels(['instagram', 'tiktok'], { networks: [{ network: 'instagram' }] }, 'IMAGE_FEED')).toEqual(['tiktok: غير مرتبط بالعلامة في Metricool']);
    expect(unavailableChannels(['youtube'], { networks: [{ network: 'youtube' }] }, 'IMAGE_FEED')).toEqual(['youtube: يتطلب فيديو (Reel)']);
    // stories exist only on Instagram/Facebook (Google Business takes the image as a normal update)
    expect(unavailableChannels(['instagram', 'tiktok', 'gmb'], { networks: [{ network: 'instagram' }, { network: 'tiktok' }, { network: 'gmb' }] }, 'IMAGE_STORY')).toEqual(['tiktok: لا يدعم الستوري']);
  });
});

describe('gold poster layout', () => {
  it('renders badge, benefits, CTA and both branches as separate layers; passes layout + contrast in ar/en/ml', async () => {
    const [sc, lg] = await Promise.all([scene('poster'), logo()]);
    const cases = [
      { lang: 'ar' as const, h: 'طباعة جميع أنواع', b: 'الأكواب', s: 'بتصاميمك الخاصة', cta: 'اطلب الآن', f: ['تصاميم مخصصة', 'جودة طباعة عالية', 'مناسبات خاصة', 'هدايا الشركات'], c: contacts },
      { lang: 'en' as const, h: 'Custom printed', b: 'Mugs', s: 'With your own design', cta: 'Order Now', f: ['Custom designs', 'Premium print', 'Special occasions'], c: [{ key: 'saar', label: 'Saar', phone: '33316319' }, { key: 'salmabad', label: 'Salmabad', phone: '34315316' }] },
      { lang: 'ml' as const, h: 'കസ്റ്റം പ്രിന്റിംഗ്', b: 'മഗ്ഗുകൾ', s: 'നിങ്ങളുടെ ഡിസൈനിൽ', cta: 'ഇപ്പോൾ ഓർഡർ ചെയ്യൂ', f: ['കസ്റ്റം ഡിസൈനുകൾ', 'മികച്ച പ്രിന്റ്'], c: [{ key: 'saar', label: 'സാർ', phone: '33316319' }, { key: 'salmabad', label: 'സൽമാബാദ്', phone: '34315316' }] },
    ];
    for (const k of cases) {
      const r = await composeAdvertisement({ scene: sc, format: 'IMAGE_STORY', lang: k.lang, templateKey: 'gold-poster', headline: k.h, badge: k.b, supportingCopy: k.s, cta: k.cta, logo: lg, contacts: k.c, features: k.f });
      const ids = r.manifest.layers.map((l) => l.id);
      expect(ids).toEqual(expect.arrayContaining(['logo', 'headline', 'badge', 'support', 'cta', 'contact:saar:phone', 'contact:salmabad:phone']));
      expect(ids.filter((i) => i.startsWith('benefit:'))).toHaveLength(k.f.length);
      expect(r.manifest.layers.find((l) => l.id === 'contact:saar:phone')?.text).toBe('33316319');
      expect(checkLayout(r.manifest).filter((x) => !x.passed).map((x) => `${x.id} ${x.detail}`), k.lang).toEqual([]);
      expect((await checkContrast(r.background, r.manifest)).passed, k.lang).toBe(true);
    }
  }, 120_000);
});

describe('full-AI poster composition', () => {
  it('keeps the AI design uncropped and adds the ORIGINAL logo, CTA and verified phones in ar/en/ml', async () => {
    const { checkLogoPixels } = await import('@/lib/qc/checks');
    const { toJpeg } = await import('@/lib/render/compose');
    const [poster, lg] = await Promise.all([scene('ai-full'), logo()]);
    for (const [lang, cta, c] of [['ar', 'اطلب الآن', contacts], ['en', 'Order Now', [{ key: 'saar', label: 'Saar', phone: '33316319' }, { key: 'salmabad', label: 'Salmabad', phone: '34315316' }]], ['ml', 'ഇപ്പോൾ ഓർഡർ ചെയ്യൂ', [{ key: 'saar', label: 'സാർ', phone: '33316319' }, { key: 'salmabad', label: 'സൽമാബാദ്', phone: '34315316' }]]] as const) {
      const r = await composeAdvertisement({ scene: poster, format: 'IMAGE_STORY', lang, templateKey: 'ai-poster', headline: 'x', cta, logo: lg, contacts: [...c] });
      expect([r.width, r.height, r.templateKey]).toEqual([1080, 1920, 'ai-poster']);
      expect(r.manifest.layers.find((l) => l.id === 'contact:salmabad:phone')?.text).toBe('34315316');
      expect(checkLayout(r.manifest).filter((x) => !x.passed).map((x) => `${x.id} ${x.detail}`), lang).toEqual([]);
      const jpeg = await toJpeg(r.png);
      const logoLayer = r.layers.find((l) => l.id === 'logo')!;
      expect((await checkLogoPixels(jpeg, r.background, logoLayer.png, r.manifest.layers.find((l) => l.id === 'logo')!.rect)).passed).toBe(true);
    }
  }, 120_000);
});
