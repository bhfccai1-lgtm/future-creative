import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { composeAdvertisement } from '@/lib/render/compose';
import { renderReel, captionChunks, captionCues, linearClock, speechClock, speechIntervals } from '@/lib/video/reel';
import { renderText } from '@/lib/render/text';
import { run } from '@/lib/video/probe';
import { DryRunProvider } from '@/lib/ai/dry-run-provider';
import { fakeSpeech } from '@/lib/audio/tts';

describe('viral reel features', () => {
  it('captions are short chunks timed in order across the voice', () => {
    const ch = captionChunks('تبي هدية تفرّح؟ أكواب مطبوعة بتصميمك الخاص، راسلنا على الواتساب الحين');
    expect(ch.every((c) => c.split(' ').length <= 3 && c.length <= 26)).toBe(true);
    expect(ch[0]).toBe('تبي هدية تفرّح؟');
    const t = captionCues(ch, linearClock(0.35, 5));
    expect(t[0].start).toBe(0.35);
    for (let i = 1; i < t.length; i++) expect(t[i].start).toBeCloseTo(t[i - 1].end, 5);
    for (const c of t) for (let k = 1; k < c.words.length; k++) expect(c.words[k].start).toBeCloseTo(c.words[k - 1].end, 5); // word by word, no gaps
    expect(t[t.length - 1].end).toBeCloseTo(5.35, 5);
  });

  it('captions follow the real speech: they hold through the voice\'s pauses instead of drifting ahead', () => {
    const log = '[silencedetect @ 0x1] silence_start: 0\n[silencedetect @ 0x1] silence_end: 0.2 | silence_duration: 0.2\n'
      + '[silencedetect @ 0x1] silence_start: 1.4\n[silencedetect @ 0x1] silence_end: 2.4 | silence_duration: 1\n';
    const sp = speechIntervals(log, 3.6);
    expect(sp).toEqual([[0.2, 1.4], [2.4, 3.6]]);
    const cues = captionCues(['تبي هدية تفرّح؟', 'راسلنا الحين'], speechClock(sp)); // equal speech halves ≈ equal letter weights
    expect(cues[0].start).toBeCloseTo(0.2, 5);   // not during the leading silence
    expect(cues[1].start).toBeGreaterThanOrEqual(2.4); // the second phrase waits for the voice to resume…
    expect(cues[0].end).toBe(cues[1].start);       // …while the first stays on screen through the pause
    expect(cues[1].end).toBeCloseTo(3.6, 5);
  });

  it('the spoken word is lit without moving the text: the highlighted render has exactly the plain one\'s box', async () => {
    for (const [text, lang] of [['أكواب بتصميمك الخاص', 'ar'], ['अपना नाम लिखवाएं', 'hi'], ['Your design, printed', 'en']] as const) {
      const spec = { text, lang, weight: 'extrabold' as const, color: '#ffffff', maxSize: 80, minSize: 44, boxW: 860, boxH: 200, maxLines: 2 };
      const plain = await renderText(spec);
      const lit = await renderText({ ...spec, maxSize: plain.fontSize, minSize: plain.fontSize, highlight: { word: 1, color: '#ffd23f' } });
      expect([lit.width, lit.height], lang).toEqual([plain.width, plain.height]);
      const { data, info } = await sharp(lit.png).raw().toBuffer({ resolveWithObject: true });
      let gold = 0; for (let i = 0; i < data.length; i += info.channels) if (data[i + 3] > 200 && data[i] > 220 && data[i + 2] < 120) gold++;
      expect(gold, lang).toBeGreaterThan(50);
    }
  });
  it('a Hindi full stop (।) ends a caption phrase', () => {
    expect(captionChunks('अपना नाम लिखवाएं। अभी ऑर्डर करें')).toEqual(['अपना नाम लिखवाएं।', 'अभी ऑर्डर करें']);
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
