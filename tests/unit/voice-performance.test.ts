import { describe, expect, it } from 'vitest';
import { autoEmotion, autoStyle, breathe, checkPerformance, directionInstructions, EMOTIONS, performanceMap, STYLES, writerDirection } from '@/lib/audio/performance';
import { ttsInstructions } from '@/lib/audio/tts';
import { PERSONAS, VOICE_LANGS } from '@/lib/audio/voices';
import { applyLexicon } from '@/lib/audio/pronounce';

const words = (s: string) => s.replace(/[،,.!?؟…]/g, ' ').split(/\s+/).filter(Boolean);

describe('voice director: emotion, style and intensity', () => {
  it('automatic feeling: the occasion first, then the product category', () => {
    expect(autoEmotion({ occasion: 'bahrain_national_day', category: 'هدايا' })).toBe('proud');
    expect(autoEmotion({ occasion: 'mothers_day' })).toBe('tender');
    expect(autoEmotion({ occasion: 'ramadan' })).toBe('warm');
    expect(autoEmotion({ category: 'مطبوعات الشركات' })).toBe('trust');
    expect(autoEmotion({ category: 'الهدايا الشخصية' })).toBe('tender');
    expect(autoEmotion({})).toBe('warm');
    for (const id of ['proud', 'tender', 'warm', 'trust']) expect(EMOTIONS.some((e) => e.id === id)).toBe(true);
  });
  it('automatic style follows the persona (a storyteller tells stories, a youth creator talks like a friend)', () => {
    expect(autoStyle('story')).toBe('storytelling');
    expect(autoStyle('youth')).toBe('conversational');
    expect(autoStyle('broadcast')).toBe('news');
    expect(autoStyle('ad', 'مطبوعات الشركات')).toBe('announcer');
    for (const id of ['storytelling', 'conversational', 'news', 'announcer']) expect(STYLES.some((s) => s.id === id)).toBe(true);
  });
  it('the writer receives the style\'s writing rule and the emotion; unknown ids are ignored', () => {
    const d = writerDirection({ emotion: 'nostalgic', style: 'testimonial' });
    expect(d.emotion).toContain('nostalgic');
    expect(d.style).toContain('First person');
    expect(writerDirection({ emotion: 'nope', style: 'auto' })).toEqual({});
  });
  it('delivery instructions carry the emotion, the style and the intensity', () => {
    const t = directionInstructions({ emotion: 'luxurious', style: 'whisper', intensity: 'expressive' });
    expect(t).toContain('luxurious');
    expect(t).toContain('whisper');
    expect(t).toContain('expressive');
  });
});

describe('per-line direction never changes the words', () => {
  const script = 'تبي هدية تبقى؟ كوب بصورتكم، يفرّح القلب، راسلنا الحين';
  const lines = [
    { text: 'تبي هدية تبقى؟', emotion: 'surprise', delivery: 'rising curious question', stress: ['هدية'], pause: 'short' },
    { text: 'كوب بصورتكم، يفرّح القلب،', emotion: 'tender', delivery: 'soft smile, slower', stress: ['القلب', 'غير موجودة'], pause: 'long' },
    { text: 'راسلنا الحين', emotion: 'trust', delivery: 'confident warm close', stress: [], pause: 'none' },
  ];
  it('accepted when the lines cover the script word for word; stress words must be in their line', () => {
    const p = checkPerformance(script, lines)!;
    expect(p).toHaveLength(3);
    expect(p[1].stress).toEqual(['القلب']); // the word that is not in the line is dropped
    expect(p[0].emotion).toBe('surprise');
  });
  it('rejected when a word is added, dropped or changed (the read falls back to the global direction)', () => {
    expect(checkPerformance(script, [...lines.slice(0, 2), { ...lines[2], text: 'راسلنا اليوم' }])).toBeNull();
    expect(checkPerformance(script, lines.slice(0, 2))).toBeNull();
    expect(checkPerformance(script, 'x')).toBeNull();
  });
  it('an unknown emotion becomes «warm»; diacritics and punctuation do not count as changes', () => {
    const p = checkPerformance('أكواب بتصميمك', [{ text: 'أَكْوَاب بِتَصْمِيمَك!', emotion: 'angry', delivery: '', stress: [], pause: 'x' }])!;
    expect(p[0].emotion).toBe('warm');
    expect(p[0].pause).toBe('short');
  });
  it('the voice model gets a numbered performance map instead of the generic arc', () => {
    const p = checkPerformance(script, lines)!;
    const map = performanceMap(p);
    expect(map).toContain('1) «تبي هدية تبقى؟»');
    expect(map).toContain('stress «هدية»');
    expect(map).toContain('clear pause');
    const persona = PERSONAS[0], lang = VOICE_LANGS[0];
    const withMap = ttsInstructions(persona, lang, { direction: { emotion: 'tender', style: 'storytelling', intensity: 'natural', lines: p } });
    expect(withMap).toContain('PERFORMANCE MAP');
    expect(withMap).toContain('Storyteller');
    expect(withMap).not.toContain('Emotional journey');
    const plain = ttsInstructions(persona, lang, { mood: 'warm' });
    expect(plain).toContain('Emotional journey'); // unchanged behaviour without direction
    expect(plain).toContain('Read the text exactly as written');
  });
});

describe('breathing room for the voice and the captions', () => {
  it('long runs get commas at natural points; no word is added, dropped or changed', () => {
    const long = 'كوب مطبوع بصورة العائلة على طاولة الإفطار مع أجمل ذكرى لكل يوم في البيت';
    const out = breathe(long);
    expect(words(out)).toEqual(words(long));
    expect(out).toContain('،');
    for (const part of out.split('،')) expect(words(part).length).toBeLessThanOrEqual(6);
  });
  it('short phrases and already-punctuated scripts are left alone; Latin scripts get a comma', () => {
    expect(breathe('تبي هدية؟ راسلنا الحين')).toBe('تبي هدية؟ راسلنا الحين');
    expect(breathe('a custom mug with your family photo for every single morning at home')).toContain(',');
  });
});

describe('pronunciation dictionary: new print-trade terms, whole words only', () => {
  it('re-spells trade words and leaves longer words that contain them untouched', () => {
    expect(applyLexicon('طباعة سبلميشن وستيكر', [])).toBe('طباعة سَبْلِمِيشَن وستيكر'); // «وستيكر» is one word: not replaced
    expect(applyLexicon('ستيكر بتصميمك', [])).toBe('سْتِيكَر بِتَصْمِيمَك');
    expect(applyLexicon('الهدايا الخاصة', [])).toBe('الهدايا الخاصة');
    expect(applyLexicon('حفل التخرج', [])).toBe('حفل التَّخَرُّج');
  });
});
