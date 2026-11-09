import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import type { ComposeResult, PlacedLayer } from '../render/compose';
import { COLORS } from '../render/compose';
import { probeVideo, run, REEL_REQUIREMENTS, type VideoProbe } from './probe';

export interface ReelResult { mp4: Buffer; probe: VideoProbe; thumbnail: Buffer }

export class VideoRenderError extends Error {}

/**
 * Builds a real animated 9:16 MP4 (not a static picture):
 *  - slow push-in camera move (zoompan) over the AI scene
 *  - headline slides up + fades in, supporting copy fades in after it
 *  - logo, CTA and contact blocks fade in with staggered timing
 *  - final ~3s end card: logo, CTA and both phone numbers on navy
 * H.264 High / yuv420p / 30fps / AAC silent track / faststart.
 */
export async function renderReel(c: ComposeResult, durationSec = 12): Promise<ReelResult> {
  if (c.width !== 1080 || c.height !== 1920) throw new VideoRenderError('Reels require a 1080x1920 composition');
  const D = Math.max(6, Math.min(60, durationSec));
  const FPS = 30, frames = Math.round(D * FPS);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-reel-'));
  try {
    await fs.writeFile(path.join(dir, 'bg.png'), c.background);
    const byId = (id: string) => c.layers.find((l) => l.id === id);
    const timeline: { layer: PlacedLayer; start: number; slide: number }[] = [];
    const push = (l: PlacedLayer | undefined, start: number, slide = 0) => l && timeline.push({ layer: l, start, slide });
    push(byId('logo'), 0.3);
    push(byId('headline'), 0.8, 90);
    push(byId('support'), 1.8, 40);
    push(byId('cta'), 2.6, 30);
    c.layers.filter((l) => l.id.startsWith('contact:')).forEach((l, i) => push(l, 3.0 + i * 0.15));

    // End card (deterministic layers re-composed on navy)
    const endStart = D - 3;
    const end = await buildEndCard(c);
    await fs.writeFile(path.join(dir, 'end.png'), end);

    const inputs: string[] = ['-loop', '1', '-framerate', String(FPS), '-t', String(D), '-i', path.join(dir, 'bg.png')];
    for (let i = 0; i < timeline.length; i++) {
      const f = path.join(dir, `l${i}.png`);
      await fs.writeFile(f, timeline[i].layer.png);
      inputs.push('-loop', '1', '-framerate', String(FPS), '-t', String(D), '-i', f);
    }
    inputs.push('-loop', '1', '-framerate', String(FPS), '-t', String(D), '-i', path.join(dir, 'end.png'));
    inputs.push('-f', 'lavfi', '-t', String(D), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
    const endIdx = timeline.length + 1, audioIdx = timeline.length + 2;

    // Camera: upscale then push-in 1.0 → 1.10 centred, rendered at output size.
    const filters: string[] = [
      `[0:v]scale=2160:3840,zoompan=z='1+0.10*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=${FPS},format=rgba[v0]`,
    ];
    let prev = 'v0';
    timeline.forEach((t, i) => {
      const idx = i + 1;
      filters.push(`[${idx}:v]format=rgba,fade=t=in:st=${t.start}:d=0.6:alpha=1[o${idx}]`);
      const y = t.slide ? `'${t.layer.top}+${t.slide}*max(0\\,1-(t-${t.start})/0.6)*gte(1\\,(t-${t.start})/0.6)'` : String(t.layer.top);
      filters.push(`[${prev}][o${idx}]overlay=x=${t.layer.left}:y=${y}:enable='gte(t,${t.start})':eval=frame[v${idx}]`);
      prev = `v${idx}`;
    });
    filters.push(`[${endIdx}:v]format=rgba,fade=t=in:st=${endStart}:d=0.7:alpha=1[end]`);
    filters.push(`[${prev}][end]overlay=0:0:enable='gte(t,${endStart})',format=yuv420p[vout]`);

    const out = path.join(dir, 'reel.mp4');
    const args = [
      '-y', '-hide_banner', '-loglevel', 'error', ...inputs,
      '-filter_complex', filters.join(';'),
      '-map', '[vout]', '-map', `${audioIdx}:a`,
      '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.1', '-preset', 'medium', '-crf', '20', '-maxrate', '8M', '-bufsize', '16M',
      '-pix_fmt', 'yuv420p', '-r', String(FPS), '-g', String(FPS * 2),
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
      '-t', String(D), '-movflags', '+faststart', out,
    ];
    const r = await run(process.env.FFMPEG_PATH ?? 'ffmpeg', args, 600_000);
    if (r.code !== 0) throw new VideoRenderError(`ffmpeg failed (${r.code}): ${r.stderr.slice(-800)}`);
    const probe = await probeVideo(out, { ...REEL_REQUIREMENTS, targetSec: D });
    const thumbFile = path.join(dir, 'thumb.jpg');
    await run(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(Math.min(4.5, D - 3.5)), '-i', out, '-frames:v', '1', '-q:v', '3', thumbFile], 60_000);
    return { mp4: await fs.readFile(out), probe, thumbnail: await fs.readFile(thumbFile) };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function buildEndCard(c: ComposeResult): Promise<Buffer> {
  const W = c.width, H = c.height;
  const logo = c.layers.find((l) => l.id === 'logo');
  const cta = c.layers.find((l) => l.id === 'cta');
  const contacts = c.layers.filter((l) => l.id.startsWith('contact:'));
  const comps: { input: Buffer; left: number; top: number }[] = [];
  if (logo) {
    const big = await sharp(logo.png).resize(Math.round(W * 0.6), Math.round(H * 0.18), { fit: 'inside' }).png().toBuffer();
    const m = await sharp(big).metadata();
    comps.push({ input: big, left: Math.round((W - m.width!) / 2), top: Math.round(H * 0.24) });
  }
  if (cta) comps.push({ input: cta.png, left: cta.left, top: Math.round(H * 0.52) });
  const contactTop = Math.min(...contacts.map((l) => l.top));
  for (const l of contacts) comps.push({ input: l.png, left: l.left, top: Math.round(H * 0.64) + (l.top - contactTop) });
  const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><radialGradient id="g" cx="0.5" cy="0.4" r="0.8"><stop offset="0" stop-color="${COLORS.navyMid}"/><stop offset="1" stop-color="${COLORS.navy}"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><rect x="${W * 0.2}" y="${H * 0.47}" width="${W * 0.6}" height="4" fill="${COLORS.gold}"/></svg>`;
  return sharp(Buffer.from(bg)).composite(comps).png().toBuffer();
}
