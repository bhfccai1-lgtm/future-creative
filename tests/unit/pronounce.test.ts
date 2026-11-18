import { describe, expect, it } from 'vitest';
import { applyLexicon, wordAccuracy, missedWords, speakVerified, normalizeForCompare } from '@/lib/audio/pronounce';

describe('pronunciation lexicon', () => {
  it('replaces whole words only, longest phrase first, owner entries win', () => {
    expect(applyLexicon('فرع سار وفرع سلماباد', [])).toBe('فرع سَار وفرع سَلْمَابَاد');
    expect(applyLexicon('أسارع إليكم', [])).toBe('أسارع إليكم'); // «سار» inside a word is untouched
    expect(applyLexicon('مطبعة إبداع المستقبل', [])).toContain('إِبْدَاعِ المُسْتَقْبَل');
    expect(applyLexicon('طباعة DTF و UV', [])).toBe('طباعة دِي تِي إِف و يُو فِي');
    expect(applyLexicon('كوب', [{ from: 'كوب', to: 'كُوبْ!' }])).toBe('كُوبْ!');
  });
});

describe('listen-back check', () => {
  it('compares Arabic ignoring diacritics, hamza seats and ta marbuta', () => {
    expect(normalizeForCompare('مَطْبَعَةُ إبداع')).toEqual(['مطبعه', 'ابداع']);
    expect(wordAccuracy('أكواب بتصميمك الخاص هدية تبقى', 'اكواب بتصميمك الخاص هديه تبقى')).toBe(1);
    expect(wordAccuracy('أكواب بتصميمك الخاص هدية تبقى', 'اكواب بتصميم الخاص')).toBe(0.4);
    expect(missedWords('أكواب بتصميمك الخاص', 'اكواب الخاص')).toEqual(['بتصميمك']);
  });
  it('re-takes slower once when words were not understood and keeps the better take', async () => {
    const calls: string[] = [];
    const r = await speakVerified('أكواب بتصميمك الخاص هدية تبقى ذكرى', {
      speak: async (_t, pace, note) => { calls.push(`${pace}${note ? ':note' : ''}`); return Buffer.from(pace); },
      transcribe: async (a) => (a.toString() === 'normal' ? 'اكواب الخاص' : 'اكواب بتصميمك الخاص هديه تبقى ذكرى'),
    });
    expect(calls).toEqual(['normal', 'slow:note']);
    expect(r.best).toMatchObject({ pace: 'slow', accuracy: 1 });
  });
  it('a clear first take is kept; a failing transcriber never blocks the voice-over', async () => {
    const ok = await speakVerified('هلا', { speak: async () => Buffer.from('x'), transcribe: async () => 'هلا' });
    expect(ok.takes).toHaveLength(1);
    const noEar = await speakVerified('هلا', { speak: async () => Buffer.from('x'), transcribe: async () => { throw new Error('down'); } });
    expect(noEar.best.accuracy).toBeNull();
  });
});
