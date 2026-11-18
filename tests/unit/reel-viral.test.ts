import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { composeAdvertisement } from '@/lib/render/compose';
import { renderReel, captionChunks, captionTimings } from '@/lib/video/reel';
import { run } from '@/lib/video/probe';
import { DryRunProvider } from '@/lib/ai/dry-run-provider';
import { fakeSpeech } from '@/lib/audio/tts';

describe('viral reel features', () => {
  it('captions are short chunks timed in order across the voice', () => {
    const ch = captionChunks('تبي هدية تفرّح؟ أكواب مطبوعة بتصميمك الخاص، راسلنا على الواتساب الحين');
    expect(ch.every((c) => c.split(' ').length <= 3 && c.length <= 26)).toBe(true);
    expect(ch[0]).toBe('تبي هدية تفرّح؟');
    const t = captionTimings(ch, 0.35, 5);
    expect(t[0].start).toBe(0.35);
    for (let i = 1; i < t.length; i++) expect(t[i].start).toBeCloseTo(t[i - 1].end, 5);
  });
  it('renders burned-in captions, loops back into the design and uses the full design as cover', async () => {
    const scene = (await new DryRunProvider().generateScene('', { size: '1024x1536', seedHint: 'viral' })).png;
    const logo = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="200"><rect width="500" height="200" rx="40" fill="#d4af37"/></svg>')).png().toBuffer();
    const c = await composeAdvertisement({ scene, format: 'REEL_VIDEO', lang: 'ar', headline: 'أكواب بتصميمك', supportingCopy: 'هدية تحمل ذكرى', cta: 'اطلب الآن', logo, contacts: [{ key: 'saar', label: 'فرع سار', phone: '33316319' }, { key: 'salmabad', label: 'فرع سلماباد', phone: '34315316' }] });
    const voice = fakeSpeech('تبي هدية تفرّح؟ أكواب مطبوعة بتصميمك الخاص راسلنا الحين');
    const r = await renderReel(c, 8, { audio: 'voiceover', voice, captions: { text: 'تبي هدية تفرّح؟ أكواب مطبوعة بتصميمك الخاص، راسلنا الحين', lang: 'ar' } });
    expect(r.probe.valid).toBe(true);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-vr-')); const f = path.join(dir, 'r.mp4'); await fs.writeFile(f, r.mp4);
    const frame = async (t: number) => { const o = path.join(dir, `f${t}.png`); await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', o]); return o; };
    // a caption pill (gold border) is present around y≈1250 while the voice speaks, absent on the end card
    const goldRows = async (file: string) => {
      const { data, info } = await sharp(file).extract({ left: 60, top: 1150, width: 960, height: 200 }).raw().toBuffer({ resolveWithObject: true });
      let n = 0; for (let i = 0; i < data.length; i += info.channels) if (data[i] > 200 && data[i + 1] > 170 && data[i + 2] < 140) n++;
      return n;
    };
    expect(await goldRows(await frame(1.2))).toBeGreaterThan(300);
    // the cover is the complete design
    const cover = await sharp(r.thumbnail).metadata();
    expect([cover.width, cover.height]).toEqual([1080, 1920]);
    if (process.env.REEL_FRAMES_OUT) for (const t of [0.2, 1.2, 3.0, 7.8]) await fs.copyFile(await frame(t), path.join(process.env.REEL_FRAMES_OUT, `viral-${t}.png`));
  }, 300_000);
});
