import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import type { ComposeResult, PlacedLayer } from '../render/compose';
import { THEMES } from '../render/compose';
import { probeVideo, run, REEL_REQUIREMENTS, type VideoProbe } from './probe';

export interface ReelResult { mp4: Buffer; probe: VideoProbe; thumbnail: Buffer; scenes: number; audio: ReelAudio; nativeAudio?: boolean; aiVideo?: boolean }
export type ReelAudio = 'none' | 'ambient' | 'upbeat' | 'instagram';
export interface ReelOptions {
  /** Hook opening (default true): headline + badge on frame 0 and a fast punch-in on the first scene. */
  hook?: boolean;
  /** AI video clip (e.g. Gemini Veo) used as the moving base instead of the still scene(s). */
  baseVideo?: Buffer;
  /** Keep the base clip's own soundtrack (Veo native audio) instead of `audio`. */
  nativeAudio?: boolean;
  /** Extra decorated backgrounds (same layout/theme) → "pro" multi-scene reel with transitions. */
  extraBackgrounds?: Buffer[];
  /** none / instagram (licensed IG audio is attached by the publisher) → silent AAC track; ambient / upbeat → royalty-free audio synthesised by FFmpeg. */
  audio?: ReelAudio;
}

export class VideoRenderError extends Error {}

const FPS = 30;
const XFADE = 0.7; // seconds
const TRANSITIONS = ['fade', 'smoothleft', 'circleopen', 'slideup', 'smoothright'];
/** Camera moves per scene: push-in, pull-out, pan right, pan left (applied on a 2× upscaled frame). */
/**
 * Opening "snap" for scene 1: fast punch-in (1.30 → 1.12 in the first ~0.8 s), then a slow drift.
 * Real data on these accounts: 75–84 % of viewers skipped within the first 3 s of slow openings.
 */
const HOOK_MOTION = (F: number) => {
  const H = Math.min(24, Math.max(6, Math.round(F / 6)));
  return `z='if(lt(on,${H}),1.30-0.18*on/${H},1.12+0.06*(on-${H})/${Math.max(1, F - H)})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
};
const MOTIONS = [
  (F: number) => `z='1+0.10*on/${F}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`,
  (F: number) => `z='1.12-0.10*on/${F}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`,
  (F: number) => `z='1.10':x='(iw-iw/zoom)*on/${F}':y='ih/2-(ih/zoom/2)'`,
  (F: number) => `z='1.10':x='(iw-iw/zoom)*(1-on/${F})':y='ih/2-(ih/zoom/2)'`,
];

/** Royalty-free audio generated mathematically (no third-party music, no licensing risk). */
export function audioSource(kind: ReelAudio, D: number): string {
  const e = (x: string) => x.replace(/,/g, '\\,'); // escape commas inside the lavfi expression
  if (kind === 'ambient') {
    // slow C → Am pad (4 s each), gentle tremolo
    const f = (a: number, b: number) => `if(lt(mod(t,8),4),${a},${b})`;
    const pad = `(sin(2*PI*${f(261.63, 220)}*t)+sin(2*PI*${f(329.63, 261.63)}*t)+sin(2*PI*${f(392, 329.63)}*t)+0.5*sin(2*PI*${f(523.25, 440)}*t))*(0.65+0.35*sin(2*PI*0.25*t))*0.07`;
    return `aevalsrc=${e(`${pad}|${pad}`)}:s=44100:d=${D},lowpass=f=1800,afade=t=in:d=1.5,afade=t=out:st=${Math.max(0, D - 2)}:d=2`;
  }
  if (kind === 'upbeat') {
    // 120 bpm: kick on beats, hi-hat on off-beats, bass + chord stabs
    const kick = 'sin(2*PI*(45+90*exp(-28*mod(t,0.5)))*t)*exp(-9*mod(t,0.5))*0.55';
    const hat = '(random(0)*2-1)*exp(-70*mod(t+0.25,0.5))*0.12';
    const bass = `sin(2*PI*${'if(lt(mod(t,4),2),55,65.41)'}*t)*0.12*(0.5+0.5*exp(-6*mod(t,0.5)))`;
    const stab = `(sin(2*PI*261.63*t)+sin(2*PI*329.63*t)+sin(2*PI*392*t))*exp(-10*mod(t+0.25,1))*0.035`;
    const mix = `${kick}+${hat}+${bass}+${stab}`;
    return `aevalsrc=${e(`${mix}|${mix}`)}:s=44100:d=${D},volume=0.6,alimiter=limit=0.7,afade=t=in:d=0.3,afade=t=out:st=${Math.max(0, D - 1.5)}:d=1.5`;
  }
  return `anullsrc=channel_layout=stereo:sample_rate=44100`;
}

/**
 * Builds a real animated 9:16 MP4 (not a static picture):
 *  - standard: one AI scene with a slow push-in camera move
 *  - pro: several AI scenes, each with its own camera move, joined by cinematic xfade transitions
 *  - headline / supporting copy / CTA / contacts animate in (scene-by-scene in pro mode); logo always visible
 *  - final ~3 s end card (logo, CTA, both phone numbers) in the design theme
 * H.264 High / yuv420p / 30 fps / AAC (silent or royalty-free music) / faststart.
 */
export async function renderReel(c: ComposeResult, durationSec = 12, opts: ReelOptions = {}): Promise<ReelResult> {
  if (c.width !== 1080 || c.height !== 1920) throw new VideoRenderError('Reels require a 1080x1920 composition');
  const D = Math.max(6, Math.min(60, durationSec));
  const backgrounds = opts.baseVideo ? [c.background] : [c.background, ...(opts.extraBackgrounds ?? [])];
  const n = backgrounds.length;
  const audio: ReelAudio = opts.audio ?? 'none';
  const endStart = D - 3;
  // scene length so that n scenes joined by (n-1) transitions fill [0, endStart + XFADE]
  const S = endStart + XFADE;
  const L = n === 1 ? D : (S + (n - 1) * XFADE) / n;
  if (n > 1 && L < 2.2) throw new VideoRenderError(`Reel too short for ${n} scenes (${D}s)`);
  const sceneStart = (i: number) => (n === 1 ? 0 : i * (L - XFADE));

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-reel-'));
  try {
    const inputs: string[] = [];
    const filters: string[] = [];
    let baseHasAudio = false;
    if (opts.baseVideo) {
      // AI clip as the moving base: fill 9:16, 30 fps, hold the last frame under the end card, add a contrast shade for the verified text layers
      const vf = path.join(dir, 'base.mp4');
      await fs.writeFile(vf, opts.baseVideo);
      const bp = await probeVideo(vf, { ...REEL_REQUIREMENTS, width: 0, height: 0, minSec: 0.5 });
      baseHasAudio = bp.hasAudio;
      const clip = Math.max(1, Math.min(bp.durationSec || endStart, endStart + XFADE));
      inputs.push('-i', vf);
      const th = THEMES[c.themeKey ?? 'navy_gold'];
      const shade = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><defs><linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${th.panel}" stop-opacity="0.75"/><stop offset="0.3" stop-color="${th.panel}" stop-opacity="0"/><stop offset="0.58" stop-color="${th.panel}" stop-opacity="0"/><stop offset="1" stop-color="${th.panel}" stop-opacity="0.92"/></linearGradient></defs><rect width="1080" height="1920" fill="url(#t)"/></svg>`);
      const sf = path.join(dir, 'shade.png'); await fs.writeFile(sf, await sharp(shade).png().toBuffer());
      inputs.push('-loop', '1', '-framerate', String(FPS), '-t', String(D), '-i', sf);
      filters.push(`[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=${FPS},setsar=1,trim=duration=${clip.toFixed(3)},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${D},trim=duration=${D},format=rgba[raw0]`);
      filters.push(`[1:v]format=rgba[shade]`);
      filters.push(`[raw0][shade]overlay=0:0[s0]`);
    }
    for (let i = 0; i < n && !opts.baseVideo; i++) {
      const f = path.join(dir, `bg${i}.png`);
      await fs.writeFile(f, backgrounds[i]);
      const len = n === 1 ? D : L;
      const frames = Math.round(len * FPS);
      inputs.push('-loop', '1', '-framerate', String(FPS), '-t', len.toFixed(3), '-i', f);
      const motion = i === 0 && opts.hook !== false ? HOOK_MOTION(frames) : MOTIONS[i % MOTIONS.length](frames);
      filters.push(`[${i}:v]scale=2160:3840,zoompan=${motion}:d=1:s=1080x1920:fps=${FPS},format=rgba,setsar=1[s${i}]`);
    }
    let base = 's0';
    for (let i = 1; i < n; i++) {
      const out = `x${i}`;
      filters.push(`[${base}][s${i}]xfade=transition=${TRANSITIONS[(i - 1) % TRANSITIONS.length]}:duration=${XFADE}:offset=${(i * (L - XFADE)).toFixed(3)}[${out}]`);
      base = out;
    }
    if (n > 1) { filters.push(`[${base}]tpad=stop_mode=clone:stop_duration=${D},trim=duration=${D}[vb]`); base = 'vb'; }

    // overlay timeline — pro mode spreads the copy across scenes
    const byId = (id: string) => c.layers.find((l) => l.id === id);
    const timeline: { layer: PlacedLayer; start: number; slide: number; fade: number }[] = [];
    const push = (l: PlacedLayer | undefined, start: number, slide = 0, fade = 0.6) => l && timeline.push({ layer: l, start, slide, fade });
    const last = n - 1;
    const hook = opts.hook !== false;
    // Hook mode: the promise (headline + product badge) is readable on the very first frame.
    push(byId('logo'), hook ? 0 : 0.3, 0, hook ? 0.2 : 0.6);
    push(byId('headline'), hook ? 0 : 0.8, hook ? 40 : 90, hook ? 0.25 : 0.6);
    push(byId('badge'), hook ? 0.15 : 1.2, hook ? 30 : 60, hook ? 0.25 : 0.6);
    push(byId('support'), n > 1 ? sceneStart(Math.min(1, last)) + 0.6 : hook ? 1.2 : 1.8, 40);
    push(byId('cta'), n > 1 ? sceneStart(last) + 0.5 : hook ? 2.0 : 2.6, 30);
    c.layers.filter((l) => l.id.startsWith('benefit:')).forEach((l, i) => push(l, (n > 1 ? sceneStart(Math.min(1, last)) + 1.0 : hook ? 1.5 : 2.2) + i * 0.15, 30));
    c.layers.filter((l) => l.id.startsWith('contact:')).forEach((l, i) => push(l, (n > 1 ? sceneStart(last) + 0.9 : hook ? 2.4 : 3.0) + i * 0.15));

    let idx = opts.baseVideo ? 2 : n;
    for (const t of timeline) {
      const f = path.join(dir, `l${idx}.png`);
      await fs.writeFile(f, t.layer.png);
      inputs.push('-loop', '1', '-framerate', String(FPS), '-t', String(D), '-i', f);
      filters.push(t.start === 0 && t.fade <= 0.25
        ? `[${idx}:v]format=rgba[o${idx}]` // fully visible on frame 0 (no fade-from-transparent)
        : `[${idx}:v]format=rgba,fade=t=in:st=${t.start.toFixed(2)}:d=${t.fade}:alpha=1[o${idx}]`);
      const y = t.slide ? `'${t.layer.top}+${t.slide}*max(0\\,1-(t-${t.start.toFixed(2)})/${t.fade})*gte(1\\,(t-${t.start.toFixed(2)})/${t.fade})'` : String(t.layer.top);
      filters.push(`[${base}][o${idx}]overlay=x=${t.layer.left}:y=${y}:enable='gte(t,${t.start.toFixed(2)})':eval=frame[v${idx}]`);
      base = `v${idx}`;
      idx++;
    }
    const end = await buildEndCard(c);
    await fs.writeFile(path.join(dir, 'end.png'), end);
    inputs.push('-loop', '1', '-framerate', String(FPS), '-t', String(D), '-i', path.join(dir, 'end.png'));
    const endIdx = idx++;
    filters.push(`[${endIdx}:v]format=rgba,fade=t=in:st=${endStart}:d=0.7:alpha=1[end]`);
    filters.push(`[${base}][end]overlay=0:0:enable='gte(t,${endStart})',format=yuv420p[vout]`);
    const useNative = !!opts.baseVideo && !!opts.nativeAudio && baseHasAudio;
    if (useNative) filters.push(`[0:a]aresample=44100,apad,atrim=duration=${D},afade=t=out:st=${Math.max(0, D - 1.5)}:d=1.5[aout]`);
    else inputs.push('-f', 'lavfi', '-t', String(D), '-i', audioSource(audio, D));
    const audioIdx = idx;

    const out = path.join(dir, 'reel.mp4');
    const args = [
      '-y', '-hide_banner', '-loglevel', 'error', ...inputs,
      '-filter_complex', filters.join(';'),
      '-map', '[vout]', '-map', useNative ? '[aout]' : `${audioIdx}:a`,
      '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.1', '-preset', 'medium', '-crf', '20', '-maxrate', '8M', '-bufsize', '16M',
      '-pix_fmt', 'yuv420p', '-r', String(FPS), '-g', String(FPS * 2),
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
      '-t', String(D), '-movflags', '+faststart', out,
    ];
    const r = await run(process.env.FFMPEG_PATH ?? 'ffmpeg', args, 900_000);
    if (r.code !== 0) throw new VideoRenderError(`ffmpeg failed (${r.code}): ${r.stderr.slice(-800)}`);
    const probe = await probeVideo(out, { ...REEL_REQUIREMENTS, targetSec: D });
    const thumbFile = path.join(dir, 'thumb.jpg');
    await run(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(Math.min(4.5, D - 3.5)), '-i', out, '-frames:v', '1', '-q:v', '3', thumbFile], 60_000);
    return { mp4: await fs.readFile(out), probe, thumbnail: await fs.readFile(thumbFile), scenes: n, audio, nativeAudio: useNative, aiVideo: !!opts.baseVideo };
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
  const th = THEMES[c.themeKey ?? 'navy_gold'];
  const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><radialGradient id="g" cx="0.5" cy="0.4" r="0.8"><stop offset="0" stop-color="${th.shade}" stop-opacity="0.85"/><stop offset="1" stop-color="${th.panel}"/></radialGradient></defs><rect width="100%" height="100%" fill="${th.panel}"/><rect width="100%" height="100%" fill="url(#g)"/><rect x="${W * 0.2}" y="${H * 0.47}" width="${W * 0.6}" height="4" fill="${th.accent}"/></svg>`;
  return sharp(Buffer.from(bg)).composite(comps).png().toBuffer();
}
