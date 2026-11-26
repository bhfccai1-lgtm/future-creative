import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import type { ComposeResult, PlacedLayer } from '../render/compose';
import { THEMES } from '../render/compose';
import { probeVideo, run, REEL_REQUIREMENTS, type VideoProbe } from './probe';
import { sfxSource, sfxTimeline } from '../audio/sfx';
import { renderText } from '../render/text';
import type { Lang } from '../render/fonts';

export interface ReelResult { mp4: Buffer; probe: VideoProbe; thumbnail: Buffer; scenes: number; audio: ReelAudio; nativeAudio?: boolean; aiVideo?: boolean; voiceOver?: boolean; sfx?: boolean; musicTrack?: boolean }
export type ReelAudio = 'none' | 'ambient' | 'upbeat' | 'library' | 'voiceover' | 'instagram';
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
  /** Licensed music track (from the owner's library) — used for 'library' and as the bed under a voice-over. */
  music?: { buf: Buffer; ext: string; startSec: number };
  /** Voice-over (WAV/MP3) — the music is ducked automatically while the voice speaks. */
  voice?: Buffer;
  /** Synthesised sound design (hook impact, whooshes, text pops, end chime). Never added to silent / Instagram-audio reels. */
  sfx?: boolean;
  /** Music level under a voice-over (0.1–1). */
  musicVolume?: number;
  /** Burned-in captions of the spoken script (most reels are watched muted): short 2–4-word chunks timed to the voice. */
  captions?: { text: string; lang: Lang };
  /** Seamless loop (default true): the last half-second dissolves back into the opening design, so replays feel continuous. */
  loop?: boolean;
  /** Final contact screen: brand name + product name beside the finished product (see buildEndCard). */
  endCard?: { brand: string; brandLang: Lang; product?: string; lang: Lang };
  /** Length of the final contact screen (default 3 s; 4 s for reels of 14 s and longer). */
  endSeconds?: number;
}

export class VideoRenderError extends Error {}

const FPS = 30;
const XFADE = 0.7; // seconds
// cinematic transitions only (no cheap wipes); all available since FFmpeg 4.3
const TRANSITIONS = ['fade', 'smoothleft', 'smoothup', 'fadeblack', 'smoothright'];
/** Cosine ease-in-out of progress on/F (camera moves start and stop softly, like a real slider). */
const EASE = (F: number) => `(0.5-0.5*cos(PI*min(1\\,on/${F})))`;
/** Mastering: AAC 48 kHz stereo; music/native audio normalised to −14 LUFS (Instagram/TikTok loudness). */
const AUDIO_RATE = 48000;
const LOUDNORM = 'loudnorm=I=-14:TP=-1.5:LRA=11';
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
  (F: number) => `z='1+0.10*${EASE(F)}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`,
  (F: number) => `z='1.12-0.10*${EASE(F)}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`,
  (F: number) => `z='1.10':x='(iw-iw/zoom)*${EASE(F)}':y='ih/2-(ih/zoom/2)'`,
  (F: number) => `z='1.10':x='(iw-iw/zoom)*(1-${EASE(F)})':y='ih/2-(ih/zoom/2)'`,
  // slow rise: tilt up with a gentle push-in
  (F: number) => `z='1.06+0.06*${EASE(F)}':x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*(1-${EASE(F)})'`,
];

/** Royalty-free audio generated mathematically (no third-party music, no licensing risk). */
export function audioSource(kind: ReelAudio, D: number): string {
  const e = (x: string) => x.replace(/,/g, '\\,'); // escape commas inside the lavfi expression
  if (kind === 'ambient') {
    // slow C → Am pad (4 s each), gentle tremolo
    const f = (a: number, b: number) => `if(lt(mod(t,8),4),${a},${b})`;
    const pad = `(sin(2*PI*${f(261.63, 220)}*t)+sin(2*PI*${f(329.63, 261.63)}*t)+sin(2*PI*${f(392, 329.63)}*t)+0.5*sin(2*PI*${f(523.25, 440)}*t))*(0.65+0.35*sin(2*PI*0.25*t))*0.07`;
    return `aevalsrc=${e(`${pad}|${pad}`)}:s=${AUDIO_RATE}:d=${D},lowpass=f=1800,${LOUDNORM},aresample=${AUDIO_RATE},afade=t=in:d=1.5,afade=t=out:st=${Math.max(0, D - 2)}:d=2`;
  }
  if (kind === 'upbeat') {
    // 120 bpm: kick on beats, hi-hat on off-beats, bass + chord stabs
    const kick = 'sin(2*PI*(45+90*exp(-28*mod(t,0.5)))*t)*exp(-9*mod(t,0.5))*0.55';
    const hat = '(random(0)*2-1)*exp(-70*mod(t+0.25,0.5))*0.12';
    const bass = `sin(2*PI*${'if(lt(mod(t,4),2),55,65.41)'}*t)*0.12*(0.5+0.5*exp(-6*mod(t,0.5)))`;
    const stab = `(sin(2*PI*261.63*t)+sin(2*PI*329.63*t)+sin(2*PI*392*t))*exp(-10*mod(t+0.25,1))*0.035`;
    const mix = `${kick}+${hat}+${bass}+${stab}`;
    return `aevalsrc=${e(`${mix}|${mix}`)}:s=${AUDIO_RATE}:d=${D},volume=0.6,alimiter=limit=0.7,${LOUDNORM},aresample=${AUDIO_RATE},afade=t=in:d=0.3,afade=t=out:st=${Math.max(0, D - 1.5)}:d=1.5`;
  }
  return `anullsrc=channel_layout=stereo:sample_rate=${AUDIO_RATE}`;
}

/**
 * On-screen text is clean Arabic: the diacritics the voice script carries only to guide pronunciation (e.g. «أمْلاح»)
 * are removed from captions; the shadda stays (it changes the word: «دزّي»).
 */
export const captionClean = (text: string) => text.replace(/[\u064B-\u0650\u0652\u0670]/g, '').replace(/\s+/g, ' ').trim();

/** Splits a spoken script into short caption chunks (≤ 3 words / ≤ 24 characters), keeping punctuation pauses. */
export function captionChunks(text: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  for (const w of captionClean(text).split(' ').filter(Boolean)) {
    const next = [...cur, w].join(' ');
    if (cur.length && (cur.length >= 3 || next.length > 24)) { out.push(cur.join(' ')); cur = []; }
    cur.push(w);
    if (/[،,.!؟?…:।]$/.test(w)) { out.push(cur.join(' ')); cur = []; }
  }
  if (cur.length) out.push(cur.join(' '));
  return out.map((c) => c.replace(/[،,]$/, '')).filter(Boolean);
}
/** Progress through the spoken words (0…1) → seconds. `isStart` puts a word that begins exactly at a pause after the pause. */
export type CaptionClock = (u: number, isStart: boolean) => number;
/** Even pacing over [start, start + span] (no voice, or the voice could not be analysed). */
export const linearClock = (start: number, span: number): CaptionClock => (u) => start + Math.max(0, Math.min(1, u)) * span;

/** Where the voice actually speaks: the complement of FFmpeg `silencedetect` silences within [0, total]. */
export function speechIntervals(log: string, total: number): [number, number][] {
  const starts = [...log.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) => Math.max(0, Number(m[1])));
  const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const out: [number, number][] = [];
  let t = 0;
  starts.forEach((s, i) => { if (s - t > 0.05) out.push([t, Math.min(s, total)]); t = Math.max(t, ends[i] ?? total); });
  if (total - t > 0.05) out.push([t, total]);
  return out.length ? out : [[0, total]];
}
/** Clock that only advances while the voice speaks: captions hold during pauses instead of drifting ahead of the voice. */
export function speechClock(intervals: [number, number][]): CaptionClock {
  const total = intervals.reduce((a, [s, e]) => a + (e - s), 0);
  return (u, isStart) => {
    let left = Math.max(0, Math.min(1, u)) * total;
    for (const [s, e] of intervals) { if (isStart ? left < e - s : left <= e - s) return s + left; left -= e - s; }
    return intervals[intervals.length - 1][1];
  };
}

export interface CaptionCue { text: string; start: number; end: number; words: { start: number; end: number }[] }
/**
 * Word-level caption cues: every word gets speaking time in proportion to its letters along the clock; a phrase stays
 * on screen through the pause after it (until the next phrase starts), its last word still lit.
 */
export function captionCues(chunks: string[], at: CaptionClock): CaptionCue[] {
  const words = chunks.map((c) => c.split(' ').filter(Boolean));
  const total = words.flat().reduce((a, w) => a + w.length + 1, 0) || 1;
  let acc = 0;
  const cues = words.map((ws, i) => {
    const wt = ws.map((w) => { const start = at(acc / total, true); acc += w.length + 1; return { start, end: at(acc / total, false) }; });
    return { text: chunks[i], start: wt[0]?.start ?? 0, end: wt[wt.length - 1]?.end ?? 0, words: wt };
  }).filter((c) => c.words.length);
  cues.forEach((c, i) => { const next = cues[i + 1]; if (next && next.start > c.end) { c.end = next.start; c.words[c.words.length - 1].end = next.start; } });
  return cues;
}
/** Speaking intervals of a voice file (falls back to "speaks throughout" if FFmpeg cannot analyse it). */
async function detectSpeech(file: string, total: number): Promise<[number, number][]> {
  const r = await run(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'silencedetect=noise=-38dB:d=0.18', '-f', 'null', '-'], 60_000).catch(() => null);
  return r && r.code === 0 ? speechIntervals(r.stderr, total) : [[0, total]];
}
/** The spoken word in a caption is lit in gold. */
const CAPTION_LIT = '#ffd23f';
/** Final contact screen length: 4 s on reels of 14 s and longer, 3 s on short ones (and on AI-video reels, which add 3 s). */
export const endCardSeconds = (D: number, aiVideo: boolean, override?: number) => override ?? (D >= 14 && !aiVideo ? 4 : 3);
/** Voice starts 0.35 s in (adelay). */
export const VOICE_START = 0.35;
/**
 * Where the voice-over may run: it continues over the end card (the CTA moment) instead of being cut there — cutting
 * at the end card chopped the last words mid-word. Only a voice longer than the whole reel is sped up (≤ 15 %, pitch
 * kept by atempo). `end` = when the voice finishes (captions follow it), `trim` = where the audio is cut.
 */
export function voicePlan(voiceSec: number, D: number) {
  const room = D - 0.45 - VOICE_START;
  const tempo = voiceSec > room ? Math.min(1.15, voiceSec / room) : 1;
  const end = Math.min(D - 0.45, VOICE_START + voiceSec / tempo);
  return { tempo: Math.round(tempo * 1000) / 1000, end, trim: Math.min(D - 0.2, end + 0.2) };
}
/**
 * Caption centre: just above the design's bottom block (CTA / phone numbers) — not over the middle of the frame where
 * the product is. Falls back to the lower third when the layout has no bottom block.
 */
export function captionCenterY(layers: { id: string; top: number }[], ph: number, H = 1920): number {
  const bottom = layers.filter((l) => (l.id === 'cta' || l.id.startsWith('contact:')) && l.top > H * 0.55).map((l) => l.top);
  const y = bottom.length ? Math.min(...bottom) - 28 - ph / 2 : H * 0.78;
  return Math.round(Math.max(H * 0.45, Math.min(H * 0.86, y))); // never pushed down onto the CTA
}
async function audioSeconds(file: string): Promise<number> {
  const r = await run(process.env.FFPROBE_PATH ?? 'ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], 30_000);
  const n = Number(r.stdout.trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
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
  // with art + chrome the camera moves over the art only and the chrome (contact panel, shades, plate) stays fixed under
  // the fixed text — baked together, the panel slid ~57 px and grew 12 % away from the phone numbers during the push-in
  const fixedChrome = !opts.baseVideo && !!c.art && !!c.chrome;
  const backgrounds = opts.baseVideo ? [c.background] : [fixedChrome ? c.art! : c.background, ...(opts.extraBackgrounds ?? [])];
  const n = backgrounds.length;
  const audio: ReelAudio = opts.audio ?? 'none';
  const endStart = D - endCardSeconds(D, !!opts.baseVideo, opts.endSeconds);
  // scene length so that n scenes joined by (n-1) transitions fill [0, endStart + XFADE]
  const S = endStart + XFADE;
  const L = n === 1 ? D : (S + (n - 1) * XFADE) / n;
  if (n > 1 && L < 2.2) throw new VideoRenderError(`Reel too short for ${n} scenes (${D}s)`);
  const sceneStart = (i: number) => (n === 1 ? 0 : i * (L - XFADE));

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-reel-'));
  try {
    const inputs: string[] = [];
    const filters: string[] = [];
    const addStill = (file: string) => inputs.push('-framerate', String(FPS), '-i', file);
    // Reuse the decoded frame for timed fades instead of decoding the same PNG at 30 fps.
    const timedStill = `format=rgba,tpad=stop_mode=clone:stop_duration=${D}`;
    let baseHasAudio = false;
    if (opts.baseVideo) {
      // AI clip as the moving base: fill 9:16, 30 fps, hold the last frame under the end card, add a contrast shade for the verified text layers
      const vf = path.join(dir, 'base.mp4');
      await fs.writeFile(vf, opts.baseVideo);
      const bp = await probeVideo(vf, { ...REEL_REQUIREMENTS, width: 0, height: 0, minSec: 0.5 });
      baseHasAudio = bp.hasAudio;
      const need = endStart + XFADE;
      // a short AI clip is slowed gently (≤1.25×) so the picture keeps moving instead of freezing before the end card
      const slow = bp.durationSec > 0 && bp.durationSec < need ? Math.min(1.25, need / bp.durationSec) : 1;
      const clip = Math.max(1, Math.min((bp.durationSec || endStart) * slow, need));
      inputs.push('-i', vf);
      const th = THEMES[c.themeKey ?? 'navy_gold'];
      const shade = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><defs><linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${th.panel}" stop-opacity="0.75"/><stop offset="0.3" stop-color="${th.panel}" stop-opacity="0"/><stop offset="0.58" stop-color="${th.panel}" stop-opacity="0"/><stop offset="1" stop-color="${th.panel}" stop-opacity="0.92"/></linearGradient></defs><rect width="1080" height="1920" fill="url(#t)"/></svg>`);
      const sf = path.join(dir, 'shade.png'); await fs.writeFile(sf, await sharp(shade).png().toBuffer());
      addStill(sf);
      filters.push(`[0:v]setpts=${slow.toFixed(4)}*PTS,scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,fps=${FPS},setsar=1,trim=duration=${clip.toFixed(3)},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${D},trim=duration=${D},format=rgba[raw0]`);
      filters.push(`[1:v]format=rgba[shade]`);
      filters.push(`[raw0][shade]overlay=0:0[s0]`);
    }
    for (let i = 0; i < n && !opts.baseVideo; i++) {
      const f = path.join(dir, `bg${i}.png`);
      await fs.writeFile(f, backgrounds[i]);
      const len = n === 1 ? D : L;
      const frames = Math.ceil(len * FPS);
      addStill(f);
      const motion = i === 0 && opts.hook !== false ? HOOK_MOTION(frames) : MOTIONS[i % MOTIONS.length](frames);
      // Generate the full move from one scaled frame. Each scene has its own zoompan clock.
      filters.push(`[${i}:v]scale=2160:3840:flags=lanczos,zoompan=${motion}:d=${frames}:s=1080x1920:fps=${FPS},format=rgba,setsar=1[s${i}]`);
    }
    let base = 's0';
    for (let i = 1; i < n; i++) {
      const out = `x${i}`;
      filters.push(`[${base}][s${i}]xfade=transition=${TRANSITIONS[(i - 1) % TRANSITIONS.length]}:duration=${XFADE}:offset=${(i * (L - XFADE)).toFixed(3)}[${out}]`);
      base = out;
    }
    if (n > 1) { filters.push(`[${base}]tpad=stop_mode=clone:stop_duration=${D},trim=duration=${D}[vb]`); base = 'vb'; }
    if (fixedChrome) {
      const cf = path.join(dir, 'chrome.png'); await fs.writeFile(cf, c.chrome!);
      addStill(cf);
      filters.push(`[${inputs.filter((x) => x === '-i').length - 1}:v]format=rgba[chrome]`, `[${base}][chrome]overlay=0:0[vc]`);
      base = 'vc';
    }

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

    let idx = opts.baseVideo ? 2 : n + (fixedChrome ? 1 : 0); // the fixed chrome took input n
    for (const t of timeline) {
      const f = path.join(dir, `l${idx}.png`);
      await fs.writeFile(f, t.layer.png);
      addStill(f);
      filters.push(t.start === 0 && t.fade <= 0.25
        ? `[${idx}:v]format=rgba[o${idx}]` // fully visible on frame 0 (no fade-from-transparent)
        : `[${idx}:v]${timedStill},fade=t=in:st=${t.start.toFixed(2)}:d=${t.fade}:alpha=1[o${idx}]`);
      const y = t.slide ? `'${t.layer.top}+${t.slide}*pow(max(0\\,1-(t-${t.start.toFixed(2)})/${t.fade})\\,3)'` : String(t.layer.top); // cubic ease-out
      filters.push(`[${base}][o${idx}]overlay=x=${t.layer.left}:y=${y}:enable='gte(t,${t.start.toFixed(2)})':eval=frame[v${idx}]`);
      base = `v${idx}`;
      idx++;
    }
    // burned-in captions timed to the voice (or spread over the reel without a voice) — readable with the sound off
    // the voice's real length decides its tempo, where it is cut and how the captions are timed
    let vplan: ReturnType<typeof voicePlan> | null = null, speech: [number, number][] | null = null;
    if (opts.voice) {
      const vf0 = path.join(dir, 'voice-probe.audio'); await fs.writeFile(vf0, opts.voice);
      const sec = await audioSeconds(vf0);
      if (sec) { vplan = voicePlan(sec, D); speech = await detectSpeech(vf0, sec); }
    }
    const capOverlays: string[] = []; // applied AFTER the end card, so the last words stay captioned over it
    if (opts.captions?.text.trim()) {
      let vStart = VOICE_START, span = Math.max(1.5, endStart - 0.8), capEnd = endStart;
      if (vplan) { span = vplan.end - VOICE_START; capEnd = vplan.end; }
      else if (opts.voice) span = Math.min(span, endStart - vStart);
      else vStart = 0.6;
      // with a voice: follow its real speech (pauses included), mapped through the start delay and any tempo change
      const clock: CaptionClock = vplan && speech
        ? ((sc, tempo): CaptionClock => (u, isStart) => VOICE_START + sc(u, isStart) / tempo)(speechClock(speech), vplan.tempo)
        : linearClock(vStart, span);
      const capY = (ph: number) => captionCenterY(c.manifest.layers.map((l) => ({ id: l.id, top: l.rect.top })), ph) - Math.round(ph / 2);
      for (const cue of captionCues(captionChunks(opts.captions.text), clock)) {
        if (cue.start >= capEnd) break;
        const spec = { text: cue.text, lang: opts.captions.lang, weight: 'extrabold' as const, color: '#ffffff', maxSize: 80, minSize: 44, boxW: 860, boxH: 200, maxLines: 2 };
        const plain = await renderText(spec);
        const pw = plain.width + 64, ph = plain.height + 34, x = Math.round((1080 - pw) / 2), y = capY(ph), a = cue.start.toFixed(2);
        const pill = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${pw}" height="${ph}"><rect x="2" y="2" width="${pw - 4}" height="${ph - 4}" rx="${Math.min(40, ph / 2)}" fill="#0b1730" fill-opacity="0.78" stroke="#e6c25a" stroke-width="3"/></svg>`);
        for (let k = 0; k < cue.words.length; k++) {
          const ws = k === 0 ? cue.start : cue.words[k].start, we = Math.min(k === cue.words.length - 1 ? cue.end : cue.words[k + 1].start, capEnd);
          if (we - ws < 0.01) continue;
          // the same text at the same size with word k lit — identical box, so the pill never jumps between words
          const lit = await renderText({ ...spec, maxSize: plain.fontSize, minSize: plain.fontSize, highlight: { word: k, color: CAPTION_LIT } });
          const text = lit.width === plain.width && lit.height === plain.height ? lit.png : plain.png;
          const f = path.join(dir, `cap${idx}.png`); await fs.writeFile(f, await sharp(pill).composite([{ input: text, left: 32, top: 17 }]).png().toBuffer());
          addStill(f);
          filters.push(`[${idx}:v]format=rgba[c${idx}]`);
          // each phrase rises in softly (cubic ease-out over 0.16 s); the following words swap in place
          const yy = k === 0 ? `'${y}+18*pow(max(0\\,1-(t-${a})/0.16)\\,3)'` : String(y);
          capOverlays.push(`[c${idx}]overlay=x=${x}:y=${yy}:enable='between(t,${ws.toFixed(2)},${we.toFixed(2)})'${k === 0 ? ':eval=frame' : ''}`);
          idx++;
        }
      }
    }
    const end = await buildEndCard(c, opts.endCard);
    await fs.writeFile(path.join(dir, 'end.png'), end);
    addStill(path.join(dir, 'end.png'));
    const endIdx = idx++;
    filters.push(`[${endIdx}:v]${timedStill},fade=t=in:st=${endStart}:d=0.7:alpha=1[end]`);
    // finishing: light sharpening of the upscaled AI image, correct BT.709 conversion (no washed-out colours on phones),
    // debanding of smooth gradients and a very fine temporal grain so platform re-encoding doesn't band or smear
    let loopIdx = -1;
    if (opts.loop !== false) {
      await fs.writeFile(path.join(dir, 'loop.png'), c.png);
      addStill(path.join(dir, 'loop.png'));
      loopIdx = idx++;
      filters.push(`[${loopIdx}:v]${timedStill},fade=t=in:st=${(D - 0.5).toFixed(2)}:d=0.45:alpha=1[loopin]`);
    }
    // end card, then the captions on top of it (the voice now continues over the end card), then the loop dissolve
    let ended = `[${base}][end]overlay=0:0:enable='gte(t,${endStart})'`;
    capOverlays.forEach((o, i) => { ended += `[cap${i}];[cap${i}]${o}`; });
    filters.push(`${ended}${loopIdx >= 0 ? '[ended];[ended][loopin]overlay=0:0:enable=\'gte(t,' + (D - 0.5).toFixed(2) + ')\'' : ''},unsharp=5:5:0.4:5:5:0,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,gradfun=1.2:16,noise=c0s=2:c0f=t[vout]`);
    // ── Audio: music bed (native Veo / licensed track / synthesised) + voice-over with ducking + sound design, mastered to −14 LUFS ──
    const useNative = !!opts.baseVideo && !!opts.nativeAudio && baseHasAudio;
    const silent = !useNative && (audio === 'none' || audio === 'instagram');
    const tail = `atrim=duration=${D},afade=t=out:st=${Math.max(0, D - 1.5)}:d=1.5`;
    if (useNative) filters.push(`[0:a]aresample=${AUDIO_RATE},aformat=channel_layouts=stereo,${LOUDNORM},aresample=${AUDIO_RATE},apad,atrim=duration=${D}[mus]`);
    else if (opts.music && (audio === 'library' || audio === 'voiceover')) {
      const mf = path.join(dir, `music.${opts.music.ext}`);
      await fs.writeFile(mf, opts.music.buf);
      inputs.push('-ss', opts.music.startSec.toFixed(2), '-t', String(D + 1), '-i', mf);
      filters.push(`[${idx}:a]aresample=${AUDIO_RATE},aformat=channel_layouts=stereo,${LOUDNORM},aresample=${AUDIO_RATE},afade=t=in:d=0.4,apad,atrim=duration=${D}[mus]`);
      idx++;
    } else {
      const kind: ReelAudio = audio === 'library' || audio === 'voiceover' ? 'upbeat' : audio; // no library track yet → royalty-free synth
      inputs.push('-f', 'lavfi', '-t', String(D), '-i', audioSource(kind, D));
      filters.push(`[${idx}:a]aformat=sample_rates=${AUDIO_RATE}:channel_layouts=stereo,apad,atrim=duration=${D}[mus]`);
      idx++;
    }
    const mix: string[] = [];
    if (!silent && opts.voice) {
      const vf = path.join(dir, 'voice.audio');
      await fs.writeFile(vf, opts.voice);
      inputs.push('-i', vf);
      const vol = Math.max(0.1, Math.min(1, opts.musicVolume ?? 0.35));
      filters.push(`[${idx}:a]aresample=${AUDIO_RATE},aformat=channel_layouts=stereo,highpass=f=80,equalizer=f=280:t=q:w=1.1:g=-2,deesser=i=0.35,equalizer=f=3200:t=q:w=1.3:g=2.5,acompressor=threshold=0.125:ratio=3:attack=5:release=120,loudnorm=I=-16:TP=-1.5:LRA=7,aresample=${AUDIO_RATE},${vplan && vplan.tempo > 1 ? `atempo=${vplan.tempo},` : ''}adelay=350|350,apad,atrim=duration=${(vplan?.trim ?? endStart - 0.2).toFixed(2)},afade=t=out:st=${Math.max(0, (vplan?.trim ?? endStart - 0.2) - 0.3).toFixed(2)}:d=0.3,apad,atrim=duration=${D},asplit=2[vo1][vo2]`);
      filters.push(`[mus]volume=${vol}[mbed]`, `[mbed][vo1]sidechaincompress=threshold=0.02:ratio=10:attack=15:release=350[mduck]`);
      mix.push('[mduck]', '[vo2]');
      idx++;
    } else mix.push('[mus]');
    if (!silent && opts.sfx) {
      const ev = sfxTimeline({
        hook: opts.hook !== false && !opts.baseVideo,
        transitions: n > 1 ? Array.from({ length: n - 1 }, (_, i) => (i + 1) * (L - XFADE)) : [],
        textAt: timeline.filter((t) => t.start > 0).map((t) => t.start), endAt: endStart, duration: D,
      });
      for (const e of ev) {
        inputs.push('-f', 'lavfi', '-i', sfxSource(e.kind));
        const ms = Math.round(e.t * 1000);
        filters.push(`[${idx}:a]aformat=sample_rates=${AUDIO_RATE}:channel_layouts=stereo,volume=${e.kind === 'pop' ? 0.5 : 0.8},adelay=${ms}|${ms},apad,atrim=duration=${D}[fx${idx}]`);
        mix.push(`[fx${idx}]`);
        idx++;
      }
    }
    filters.push(silent
      ? `${mix[0]}atrim=duration=${D}[aout]`
      : `${mix.join('')}amix=inputs=${mix.length}:normalize=0:duration=first,${LOUDNORM},aresample=${AUDIO_RATE},alimiter=limit=0.89,${tail}[aout]`);

    const out = path.join(dir, 'reel.mp4');
    const args = [
      '-y', '-hide_banner', '-loglevel', 'error', ...inputs,
      '-filter_complex', filters.join(';'),
      '-map', '[vout]', '-map', '[aout]',
      // high-quality master: platforms re-encode, so a cleaner source survives better (capped at 8 Mb/s → a 60 s reel stays ≤ 60 MB)
      '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.2', '-preset', process.env.REEL_X264_PRESET ?? 'slow', '-crf', '17', '-maxrate', '8M', '-bufsize', '16M',
      '-x264-params', 'aq-mode=3:aq-strength=0.9', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-g', String(FPS * 2),
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-c:a', 'aac', '-b:a', '192k', '-ar', String(AUDIO_RATE), '-ac', '2',
      '-t', String(D), '-movflags', '+faststart', out,
    ];
    const r = await run(process.env.FFMPEG_PATH ?? 'ffmpeg', args, 900_000);
    if (r.code !== 0) throw new VideoRenderError(`ffmpeg failed (${r.code}): ${r.stderr.slice(-800)}`);
    const probe = await probeVideo(out, { ...REEL_REQUIREMENTS, targetSec: D });
    const thumbFile = path.join(dir, 'thumb.jpg');
    // cover = the complete design (headline, badge, product, CTA) — the frame that stops the scroll in the grid and feed
    await fs.writeFile(thumbFile, await sharp(c.png).flatten({ background: '#0b1730' }).jpeg({ quality: 92 }).toBuffer());
    return { mp4: await fs.readFile(out), probe, thumbnail: await fs.readFile(thumbFile), scenes: n, audio, nativeAudio: useNative, aiVideo: !!opts.baseVideo, voiceOver: !silent && !!opts.voice, sfx: !silent && !!opts.sfx, musicTrack: !useNative && !!opts.music && (audio === 'library' || audio === 'voiceover') };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** WhatsApp-style chat glyph (green disc + white handset) drawn as SVG — no third-party image file. */
const waIcon = (d: number) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}" viewBox="0 0 48 48"><circle cx="24" cy="24" r="23" fill="#25D366"/><path d="M14 35l2-6a11 11 0 1 1 4 4z" fill="none" stroke="#fff" stroke-width="2.6" stroke-linejoin="round"/><path d="M20 19c0 5 4 9 9 9l1.6-2.4-3-1.4-1.3 1.2c-1.8-.8-3.1-2.1-3.9-3.9l1.2-1.3-1.4-3z" fill="#fff"/></svg>`);

/**
 * Final contact screen (Instagram-safe: everything between y≈240 and y≈1430, clear of the top bar and the bottom
 * caption/buttons area): official logo top-right, the FINISHED PRODUCT (the ad's own scene, framed in gold), the brand
 * name, the product name, the CTA and both branches with a WhatsApp mark beside each number.
 */
async function buildEndCard(c: ComposeResult, info?: ReelOptions['endCard']): Promise<Buffer> {
  const W = c.width, H = c.height;
  const th = THEMES[c.themeKey ?? 'navy_gold'];
  const logo = c.layers.find((l) => l.id === 'logo');
  const cta = c.layers.find((l) => l.id === 'cta');
  const contacts = c.layers.filter((l) => l.id.startsWith('contact:'));
  const comps: { input: Buffer; left: number; top: number }[] = [];
  // official logo (the supplied file, scaled only) — top-right, inside the safe margin
  if (logo) {
    const small = await sharp(logo.png).resize(230, 150, { fit: 'inside' }).png().toBuffer();
    const m = await sharp(small).metadata();
    comps.push({ input: small, left: W - 60 - m.width!, top: 250 });
  }
  // the finished product: the ad's own scene (same product, same artwork), centre crop in a rounded gold frame
  const S = 500, cardTop = 420;
  const bgMeta = await sharp(c.background).metadata();
  const side = Math.min(bgMeta.width!, bgMeta.height!);
  const crop = await sharp(c.background).extract({ left: Math.round((bgMeta.width! - side) / 2), top: Math.round((bgMeta.height! - side) / 2), width: side, height: side }).resize(S, S).png().toBuffer();
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}"><rect width="${S}" height="${S}" rx="44" fill="#fff"/></svg>`);
  const rounded = await sharp(crop).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  comps.push({ input: rounded, left: Math.round((W - S) / 2), top: cardTop });
  comps.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S + 16}" height="${S + 16}"><rect x="4" y="4" width="${S + 8}" height="${S + 8}" rx="48" fill="none" stroke="${th.accent}" stroke-width="6"/></svg>`), left: Math.round((W - S) / 2) - 8, top: cardTop - 8 });
  let y = cardTop + S + 34;
  // brand name, then the product name
  if (info?.brand) {
    const t = await renderText({ text: info.brand, lang: info.brandLang, weight: 'extrabold', color: th.accent, maxSize: 66, minSize: 40, boxW: 900, boxH: 90, maxLines: 1 });
    comps.push({ input: t.png, left: Math.round((W - t.width) / 2), top: y }); y += t.height + 14;
  }
  if (info?.product) {
    const t = await renderText({ text: info.product, lang: info.lang, weight: 'bold', color: th.headline, maxSize: 48, minSize: 30, boxW: 860, boxH: 70, maxLines: 1 });
    comps.push({ input: t.png, left: Math.round((W - t.width) / 2), top: y }); y += t.height + 22;
  }
  if (cta) { comps.push({ input: cta.png, left: Math.round((W - cta.width) / 2), top: y }); y += cta.height + 30; }
  // both branches, each phone with a WhatsApp mark (the layers keep their relative layout from the design)
  if (contacts.length) {
    const top0 = Math.min(...contacts.map((l) => l.top));
    for (const l of contacts) {
      const top = y + (l.top - top0);
      comps.push({ input: l.png, left: l.left, top });
      if (l.id.endsWith(':phone')) comps.push({ input: waIcon(Math.round(l.height * 0.9)), left: Math.max(8, l.left - Math.round(l.height * 0.9) - 12), top: top + Math.round(l.height * 0.05) });
    }
  }
  const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><radialGradient id="g" cx="0.5" cy="0.4" r="0.8"><stop offset="0" stop-color="${th.shade}" stop-opacity="0.85"/><stop offset="1" stop-color="${th.panel}"/></radialGradient></defs><rect width="100%" height="100%" fill="${th.panel}"/><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
  return sharp(Buffer.from(bg)).composite(comps).png().toBuffer();
}
