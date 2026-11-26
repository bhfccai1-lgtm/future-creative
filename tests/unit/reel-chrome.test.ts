import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { composeAdvertisement } from '@/lib/render/compose';
import { renderReel } from '@/lib/video/reel';
import { run } from '@/lib/video/probe';

describe('reels: the contact panel stays with the phone numbers while the camera moves', () => {
  it('the art moves (push-in) but the panel, plate and numbers are pixel-stable once shown', async () => {
    const art = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536"><rect width="1024" height="1536" fill="#1d2f5a"/>${Array.from({ length: 60 }, (_, i) => `<circle cx="${(i * 97) % 1024}" cy="${(i * 173) % 1536}" r="18" fill="#ffd27a"/>`).join('')}</svg>`)).png().toBuffer();
    const logo = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><circle cx="200" cy="150" r="120" fill="#f39c12"/></svg>')).png().toBuffer();
    const t = { headline: 'قبل لا يطلع؟', badge: 'بطاقات QR', support: 'امسح وتواصل بسهولة' };
    const c = await composeAdvertisement({ scene: art, format: 'REEL_VIDEO', lang: 'ar', templateKey: 'ai-poster', headline: t.headline, supportingCopy: t.support, badge: t.badge, cta: 'اطلب الآن', logo, contacts: [{ key: 'saar', label: 'فرع سار', phone: '33316319' }, { key: 'salmabad', label: 'فرع سلماباد', phone: '34315316' }], typeset: t, logoPosition: 'bottom-center' });
    expect(c.art && c.chrome).toBeTruthy();
    const r = await renderReel(c, 8, { loop: false });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-chrome-')), f = path.join(dir, 'r.mp4'); await fs.writeFile(f, r.mp4);
    const frame = async (s: number) => { const o = path.join(dir, `${s}.png`); await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(s), '-i', f, '-frames:v', '1', o]); return o; };
    const [a, b] = [await frame(3.8), await frame(4.8)]; // everything shown, the camera still pushing in
    const diff = async (box: { left: number; top: number; width: number; height: number }) => {
      const [x, y] = await Promise.all([a, b].map((p) => sharp(p).extract(box).raw().toBuffer()));
      let d = 0; for (let i = 0; i < x.length; i++) d += Math.abs(x[i] - y[i]); return d / x.length;
    };
    expect(await diff({ left: 120, top: 1336, width: 840, height: 198 })).toBeLessThan(3); // panel + numbers: fixed
    expect(await diff({ left: 0, top: 700, width: 1080, height: 300 })).toBeGreaterThan(1); // the art really moves
    await fs.rm(dir, { recursive: true, force: true });
  }, 240_000);
});
