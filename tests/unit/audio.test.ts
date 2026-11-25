import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { voiceScript, fakeSpeech } from '@/lib/audio/tts';
import { sfxTimeline } from '@/lib/audio/sfx';
import { composeAdvertisement } from '@/lib/render/compose';
import { captionCenterY, captionChunks, captionClean, endCardSeconds, renderReel, voicePlan } from '@/lib/video/reel';
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
    expect(v.autoVoiceLang({ market: 'gcc_saudi', contentLang: 'ar' })).toBe('ar_sa');
    // a fixed voice language applies only to accounts in that language: the Malayalam account stays Malayalam
    expect(v.voiceLangFor('ar_bh', 'ml').id).toBe('ml');
    expect(v.voiceLangFor('ar_eg', 'ar_bh').id).toBe('ar_eg'); // same language → the owner's dialect wins
    expect(v.voiceLangFor('auto', 'ml').id).toBe('ml');
    expect(v.voiceLangFor('en_au', 'en_gb').id).toBe('en_au');
    expect(v.voiceLangFor('ar_bh', 'en_in').id).toBe('en_in');
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
  it('the read carries a feeling matched to the occasion/product and a hook → warm → confident-CTA arc', async () => {
    const { ttsInstructions, voiceMood } = await import('@/lib/audio/tts');
    const v = await import('@/lib/audio/voices');
    expect(voiceMood({ category: 'الهدايا الترويجية والشخصية' })).toMatch(/affection/);
    expect(voiceMood({ category: 'الهدايا', occasion: 'mothers_day' })).toMatch(/tender/); // the occasion wins
    expect(voiceMood({ occasion: 'bahrain_national_day' })).toMatch(/proud/);
    expect(voiceMood({ category: 'المناسبات والأعراس' })).toMatch(/joyful/);
    expect(voiceMood({ category: 'مطبوعات الشركات' })).toMatch(/trustworthy/);
    expect(voiceMood({})).toMatch(/warm/);
    const ins = ttsInstructions(v.personaOf('ad_female')!, v.voiceLangOf('ar_bh')!, { mood: voiceMood({ category: 'هدايا' }), emphasis: 'أكواب مطبوعة' });
    expect(ins).toMatch(/Emotion: heartfelt warmth/);
    expect(ins).toMatch(/FIRST line grabs attention/);
    expect(ins).toMatch(/call to action .* confident, inviting smile/);
    expect(ins).toMatch(/never flat, robotic or rushed/);
    expect(ins).toContain('«أكواب مطبوعة»');
    expect(ins).toMatch(/Finish the last syllable/);
    expect(ttsInstructions(v.personaOf('ad_female')!, v.voiceLangOf('ar_bh')!)).not.toMatch(/Emphasis:/); // no word to stress → no line
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

describe('numbers are spoken as words; phone numbers are never read', () => {
  it('Arabic and English number words, percent, decimals, lexicon first', async () => {
    const { arabicNumber, englishNumber, spellNumbers, prepareSpoken, sameWords } = await import('@/lib/audio/pronounce');
    expect([1, 2, 11, 12, 21, 105, 250, 1000, 2000, 3000, 11000, 12500].map(arabicNumber)).toEqual(['واحد', 'اثنين', 'أحد عشر', 'اثني عشر', 'واحد وعشرين', 'مئة وخمسة', 'مئتين وخمسين', 'ألف', 'ألفين', 'ثلاثة آلاف', 'أحد عشر ألف', 'اثني عشر ألف وخمسمئة']);
    expect(englishNumber(121)).toBe('one hundred twenty-one');
    expect(spellNumbers('خصم ٢٠٪ على 150 كوب', 'ar-bh')).toBe('خصم عشرين بالمئة على مئة وخمسين كوب');
    expect(spellNumbers('سعر 2.5 دينار', 'ar')).toBe('سعر اثنين فاصلة خمسة دينار');
    expect(spellNumbers('اتصل 33316319 أو +973 3431 5316', 'ar')).toBe('اتصل أو');
    expect(spellNumbers('50% off', 'en-us')).toBe('fifty percent off');
    expect(spellNumbers('١٢٣ کوب', 'ml')).toBe('123 کوب'); // no number words for this language → digits for the voice
    expect(prepareSpoken('طباعة A4 بجودة', [], 'ar')).toBe('طباعة إِيه فُور بجودة'); // used to lose the «4» before the lexicon
    expect(sameWords('مَطْبَعَة إبداع', 'مطبعة ابداع')).toBe(true);
    expect(sameWords('مطبعة إبداع', 'مطبعة جديدة')).toBe(false);
  });
});

describe('voice-over timing and caption placement', () => {
  it('the voice is never cut at the end card; only a voice longer than the reel is sped up (≤15 %)', () => {
    // real case: 12 s reel, the end card starts at 9 s, the voice lasted ~11 s → it used to be cut at 8.8 s mid-word
    expect(voicePlan(11, 12)).toMatchObject({ tempo: 1 });
    expect(voicePlan(11, 12).end).toBeCloseTo(11.35, 2);
    expect(voicePlan(11, 12).trim).toBeLessThanOrEqual(11.8);
    expect(voicePlan(13, 12).tempo).toBeCloseTo(1.15, 2); // too long even for the whole reel → capped speed-up, then cut
    expect(voicePlan(5, 12)).toMatchObject({ tempo: 1 });
    expect(voicePlan(5, 12).end).toBeCloseTo(5.35, 2);
  });
  it('captions sit just above the CTA / phone block, not over the product in the middle of the frame', () => {
    const ph = 110;
    expect(captionCenterY([{ id: 'headline', top: 200 }, { id: 'cta', top: 1580 }, { id: 'contact:s:phone', top: 1780 }], ph)).toBe(1580 - 28 - 55);
    expect(captionCenterY([{ id: 'headline', top: 200 }], ph)).toBe(Math.round(1920 * 0.78)); // no bottom block → lower third
    expect(captionCenterY([{ id: 'cta', top: 700 }], ph)).toBe(Math.round(1920 * 0.78)); // a CTA high in the frame is not a bottom block
  });
  it('renders a reel whose voice runs over the end card, with its last caption shown on the end card', async () => {
    const scene = (await new DryRunProvider().generateScene('', { size: '1024x1536', seedHint: 'cap' })).png;
    const logo = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="200"><rect width="500" height="200" fill="#d4af37"/></svg>')).png().toBuffer();
    const c = await composeAdvertisement({ scene, format: 'REEL_VIDEO', lang: 'ar', headline: 'أكواب بتصميمك', supportingCopy: 'هدية', cta: 'اطلب الآن', logo, contacts: [{ key: 's', label: 'فرع سار', phone: '33316319' }] });
    const text = 'هدية من القلب تفرح أحبابك كل يوم، اطلبيها الحين ودزي لنا كلمة على الخاص';
    const r = await renderReel(c, 8, { audio: 'voiceover', voice: fakeSpeech(text + ' ' + text.slice(0, 20)), captions: { text, lang: 'ar' } });
    expect(r.probe.valid).toBe(true);
    // 8 s reel: the end card starts at 5 s; the ~7 s voice is still talking at 6.5 s → a caption pill is on the end card
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-cap-')), f = path.join(dir, 'v.mp4');
    await fs.writeFile(f, r.mp4);
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '6.5', '-i', f, '-frames:v', '1', path.join(dir, 'e.png')]);
    const y = captionCenterY(c.manifest.layers.map((l) => ({ id: l.id, top: l.rect.top })), 110);
    const { data } = await sharp(path.join(dir, 'e.png')).extract({ left: 0, top: y - 80, width: 1080, height: 160 }).raw().toBuffer({ resolveWithObject: true });
    let gold = 0; for (let i = 0; i < data.length; i += 3) if (data[i] > 170 && data[i + 1] > 140 && data[i + 2] < 140) gold++;
    expect(gold).toBeGreaterThan(200); // the pill's gold outline
    await fs.rm(dir, { recursive: true, force: true });
  }, 300_000);
});

describe('brand final screen and clean captions', () => {
  it('captions drop the pronunciation-only diacritics but keep the shadda', () => {
    expect(captionClean('أمْلاح على الخاص')).toBe('أملاح على الخاص');
    expect(captionClean('دزّي لنا كلمة')).toBe('دزّي لنا كلمة');
    expect(captionChunks('تَصْمِيمَك  على ذوقك')).toEqual(['تصميمك على ذوقك']);
  });
  it('the final screen lasts 4 s on reels of 14 s+, 3 s on short and AI-video reels', () => {
    expect(endCardSeconds(15, false)).toBe(4);
    expect(endCardSeconds(10, false)).toBe(3);
    expect(endCardSeconds(11, true)).toBe(3);
    expect(endCardSeconds(15, false, 2)).toBe(2);
  });
  it('renders the final screen with the brand, the product and a WhatsApp mark beside each number', async () => {
    const scene = (await new DryRunProvider().generateScene('', { size: '1024x1536', seedHint: 'end' })).png;
    const logo = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="200"><rect width="500" height="200" fill="#d4af37"/></svg>')).png().toBuffer();
    const c = await composeAdvertisement({ scene, format: 'REEL_VIDEO', lang: 'ar', headline: 'هدية من قلبهم', supportingCopy: 'لمسة مرتبة', cta: 'اطلب الآن', logo, contacts: [{ key: 'saar', label: 'فرع سار', phone: '33316319' }, { key: 'salmabad', label: 'فرع سلماباد', phone: '34315316' }] });
    const r = await renderReel(c, 15, { endCard: { brand: 'مركز إبداع المستقبل', brandLang: 'ar', product: 'ملصقات تغليف الهدايا', lang: 'ar' } });
    expect(r.probe.valid).toBe(true);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-end-')), f = path.join(dir, 'v.mp4');
    await fs.writeFile(f, r.mp4);
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '13', '-i', f, '-frames:v', '1', path.join(dir, 'e.png')]);
    const { data, info } = await sharp(path.join(dir, 'e.png')).raw().toBuffer({ resolveWithObject: true });
    let green = 0, lowest = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      const [R, G, B] = [data[i], data[i + 1], data[i + 2]];
      if (G > 170 && R < 90 && B < 140) { green++; lowest = Math.max(lowest, Math.floor(i / info.channels / info.width)); }
    }
    expect(green).toBeGreaterThan(800); // two WhatsApp marks
    expect(lowest).toBeLessThan(1440); // contact block stays above Instagram's bottom caption/buttons area
    await fs.rm(dir, { recursive: true, force: true });
  }, 300_000);
});
