import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { voiceScript, fakeSpeech } from '@/lib/audio/tts';
import { sfxTimeline } from '@/lib/audio/sfx';
import { composeAdvertisement } from '@/lib/render/compose';
import { renderReel } from '@/lib/video/reel';
import { DryRunProvider } from '@/lib/ai/dry-run-provider';
import { run } from '@/lib/video/probe';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const lufs = async (mp4: Buffer) => {
  const f = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'fc-l-')), 'a.mp4'); await fs.writeFile(f, mp4);
  const r = await run('ffmpeg', ['-hide_banner', '-i', f, '-af', 'ebur128', '-f', 'null', '-']);
  return Number(/I:\s+(-?[\d.]+) LUFS/.exec(r.stderr.split('Summary:').pop()!)![1]);
};

describe('reel audio', () => {
  it('voice script uses verified copy only — no digits or links', () => {
    expect(voiceScript({ headline: 'أكواب بتصميمك', badge: 'الأكواب', support: 'اتصل 33316319 www.x.com', cta: 'اطلب الآن' })).toBe('أكواب بتصميمك… الأكواب… اتصل… اطلب الآن');
  });
  it('sound-design timeline: hook hit, whoosh before each transition, end chime', () => {
    const ev = sfxTimeline({ hook: true, transitions: [3, 6], textAt: [0, 1.2], endAt: 9, duration: 12 });
    expect(ev.map((e) => e.kind)).toEqual(['hit', 'pop', 'whoosh', 'whoosh', 'chime']);
    expect(ev.find((e) => e.kind === 'whoosh')!.t).toBeCloseTo(2.65);
  });
  it('voice-over + licensed music + SFX renders a valid reel mastered near −14 LUFS; Instagram-audio reels stay silent', async () => {
    const scene = (await new DryRunProvider().generateScene('', { size: '1024x1536', seedHint: 'a' })).png;
    const logo = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="200"><rect width="500" height="200" fill="#d4af37"/></svg>')).png().toBuffer();
    const c = await composeAdvertisement({ scene, format: 'REEL_VIDEO', lang: 'ar', headline: 'أكواب بتصميمك', supportingCopy: 'هدية', cta: 'اطلب الآن', logo, contacts: [{ key: 's', label: 'فرع سار', phone: '33316319' }] });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-t-')), tf = path.join(dir, 't.mp3');
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=f=440:d=15,volume=0.3', '-c:a', 'libmp3lame', tf]);
    const r = await renderReel(c, 8, { audio: 'voiceover', music: { buf: await fs.readFile(tf), ext: 'mp3', startSec: 1 }, voice: fakeSpeech('أكواب بتصميمك اطلب الآن'), sfx: true });
    expect(r.probe.valid).toBe(true);
    expect(r).toMatchObject({ voiceOver: true, sfx: true, musicTrack: true });
    const l = await lufs(r.mp4);
    expect(l).toBeGreaterThan(-18); expect(l).toBeLessThan(-11);
    const ig = await renderReel(c, 6, { audio: 'instagram', sfx: true, voice: fakeSpeech('x') });
    expect(ig).toMatchObject({ voiceOver: false, sfx: false });
    expect(await lufs(ig.mp4)).toBeLessThan(-60);
  }, 300_000);
});

describe('voice personas and dialects', () => {
  it('catalogue: 23 personas and 73 languages with unique ids and known groups', async () => {
    const v = await import('@/lib/audio/voices');
    expect(v.PERSONAS).toHaveLength(23);
    expect(v.VOICE_LANGS).toHaveLength(73);
    expect(new Set(v.PERSONAS.map((p) => p.id)).size).toBe(23);
    expect(new Set(v.VOICE_LANGS.map((l) => l.id)).size).toBe(73);
    for (const p of v.PERSONAS) expect(v.PERSONA_GROUPS[p.group]).toBeTruthy();
    for (const l of v.VOICE_LANGS) expect(v.LANG_GROUPS[l.group]).toBeTruthy();
    expect(v.voiceLangOf('ar_bh')!.prompt).toMatch(/Bahraini/);
  });
  it('auto choice: Bahraini by default, persona from the product category with rotation', async () => {
    const v = await import('@/lib/audio/voices');
    expect(v.autoVoiceLang({ market: null, contentLang: 'ar' })).toBe('ar_bh');
    expect(v.autoVoiceLang({ market: 'indian_community', contentLang: 'ml' })).toBe('ml');
    expect(v.autoVoiceLang({ market: 'english_expats', contentLang: 'en' })).toBe('en_gb');
    expect(v.autoPersona('الفرق والبطولات الرياضية', [])).toBe('s_commentator');
    expect(v.autoPersona('الأطفال والمدارس', ['k_girl'])).toBe('k_boy');
    expect(v.autoPersona('هدايا الموظفين والعملاء', [])).toBe('ad_male');
  });
  it('script sanitizer drops digits/links and rejects price or claim language', async () => {
    const { sanitizeScript, ttsInstructions } = await import('@/lib/audio/tts');
    const v = await import('@/lib/audio/voices');
    expect(sanitizeScript('اطلب كوبك الحين، اتصل 33316319 www.x.com', 20)).toBe('اطلب كوبك الحين، اتصل');
    expect(sanitizeScript('خصم 50% على كل الأكواب', 20)).toBeNull();
    expect(sanitizeScript(Array(40).fill('كلمة').join(' '), 10)!.split(' ')).toHaveLength(10);
    const ins = ttsInstructions(v.personaOf('e_grandpa')!, v.voiceLangOf('ar_bh')!);
    expect(ins).toMatch(/grandfather/); expect(ins).toMatch(/Bahraini/);
  });
  it('elderly voices are slowed and children are pitched up (rubberband)', async () => {
    const { shapeVoice, fakeSpeech } = await import('@/lib/audio/tts');
    const v = await import('@/lib/audio/voices');
    const src = fakeSpeech('نص تجريبي لاختبار الصوت الطويل نسبيا');
    const dur = async (b: Buffer) => { const f = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'fc-d-')), 'a.wav'); await fs.writeFile(f, b); const r = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]); return Number(r.stdout); };
    const base = await dur(src);
    expect(await dur(await shapeVoice(src, v.personaOf('e_grandpa')!))).toBeGreaterThan(base * 1.08);
    const kid = await shapeVoice(src, v.personaOf('k_girl')!);
    expect(kid.equals(src)).toBe(false);
    expect(Math.abs((await dur(kid)) - base)).toBeLessThan(0.3);
    expect(await shapeVoice(src, v.personaOf('ad_male')!)).toBe(src);
  });
});
