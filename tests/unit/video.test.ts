import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { composeAdvertisement } from '@/lib/render/compose';
import { renderReel } from '@/lib/video/reel';
import { probeVideo, run } from '@/lib/video/probe';
import { DryRunProvider } from '@/lib/ai/dry-run-provider';

describe('real video reel pipeline', () => {
  it('renders an animated 1080x1920 H.264 MP4 of the requested duration that passes validation', async () => {
    const scene = (await new DryRunProvider().generateScene('', { size: '1024x1536', seedHint: 'reel' })).png;
    const logo = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="200"><rect width="500" height="200" rx="40" fill="#d4af37"/></svg>')).png().toBuffer();
    const c = await composeAdvertisement({ scene, format: 'REEL_VIDEO', lang: 'ar', headline: 'أكواب بتصميمك', supportingCopy: 'هدية تحمل ذكرى', cta: 'اطلب الآن', logo, contacts: [{ key: 'saar', label: 'فرع سار', phone: '33316319' }, { key: 'salmabad', label: 'فرع سلماباد', phone: '34315316' }] });
    const r = await renderReel(c, 8);
    expect(r.probe.valid).toBe(true);
    expect(r.probe).toMatchObject({ codec: 'h264', width: 1080, height: 1920, pixFmt: 'yuv420p', hasAudio: true, audioCodec: 'aac' });
    expect(Math.abs(r.probe.durationSec - 8)).toBeLessThan(0.2);

    // It is genuinely moving: frames at 0.2s and 4s differ substantially
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-vt-'));
    const f = path.join(dir, 'v.mp4'); await fs.writeFile(f, r.mp4);
    for (const t of ['0.2', '4']) await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', t, '-i', f, '-frames:v', '1', path.join(dir, `f${t}.png`)]);
    const [a, b] = await Promise.all(['0.2', '4'].map((t) => sharp(path.join(dir, `f${t}.png`)).resize(108, 192).raw().toBuffer()));
    let diff = 0; for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
    expect(diff / a.length).toBeGreaterThan(5);
    await fs.rm(dir, { recursive: true, force: true });
  }, 180_000);

  it('hook opening: headline and badge are readable on the very first frame (real data: most viewers skip in the first 3 s)', async () => {
    const scene = (await new DryRunProvider().generateScene('', { size: '1024x1536', seedHint: 'hook' })).png;
    const logo = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="200"><rect width="500" height="200" rx="40" fill="#d4af37"/></svg>')).png().toBuffer();
    const c = await composeAdvertisement({ scene, format: 'REEL_VIDEO', lang: 'ar', headline: 'أكواب بتصميمك', supportingCopy: 'هدية تحمل ذكرى', cta: 'اطلب الآن', logo, contacts: [{ key: 'saar', label: 'فرع سار', phone: '33316319' }, { key: 'salmabad', label: 'فرع سلماباد', phone: '34315316' }] });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-hook-'));
    const frame0 = async (hook: boolean) => {
      const r = await renderReel(c, 7, { hook });
      const f = path.join(dir, `h${hook}.mp4`); await fs.writeFile(f, r.mp4);
      const png = path.join(dir, `h${hook}.png`);
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '0', '-i', f, '-frames:v', '1', png]);
      return png;
    };
    const head = c.layers.find((l) => l.id === 'headline')!;
    const region = { left: head.left, top: Math.max(0, head.top - 10), width: Math.min(1080 - head.left, head.width), height: Math.min(1920 - head.top, head.height + 60) };
    const [withHook, without] = await Promise.all([frame0(true), frame0(false)].map(async (p) => sharp(await p).extract(region).raw().toBuffer()));
    let diff = 0; for (let i = 0; i < withHook.length; i++) diff += Math.abs(withHook[i] - without[i]);
    expect(diff / withHook.length).toBeGreaterThan(8); // text present at t=0 only in hook mode
    if (process.env.KEEP_HOOK_FRAMES) console.log('frames in', dir); else await fs.rm(dir, { recursive: true, force: true });
  }, 240_000);

  it('rejects videos that do not meet Reels requirements', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-vt-'));
    const f = path.join(dir, 'bad.mp4');
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=640x480:d=2:r=25', '-c:v', 'libx264', '-pix_fmt', 'yuv444p', f]);
    const p = await probeVideo(f);
    expect(p.valid).toBe(false);
    expect(p.problems.join(' ')).toMatch(/dimensions/);
    expect(p.problems.join(' ')).toMatch(/pixel format/);
    expect(p.problems.join(' ')).toMatch(/duration/);
    const missing = await probeVideo(path.join(dir, 'nope.mp4'));
    expect(missing.valid).toBe(false);
    await fs.rm(dir, { recursive: true, force: true });
  }, 60_000);
});
