import { describe, expect, it } from 'vitest';
import { scoreConcepts, jaccard } from '@/lib/creative/concept-select';

const base = { title: 't', idea: 'i', hook: 'h', angle: 'gift_guide', format: 'IMAGE_STORY', score: 7, why: '' };
describe('STEP 02 concept rubric', () => {
  it('prefers strong, novel, fitting concepts and documents why', () => {
    const r = scoreConcepts([
      { ...base, title: 'كوب الصباح لمعلمتك', idea: 'هدية شكر للمعلمة في آخر يوم دراسي', score: 8 },
      { ...base, title: 'كوب العائلة', idea: 'كوب مطبوع بصورة العائلة على طاولة الإفطار', score: 9 }, // repeats history
      { ...base, title: 'خصم 50% على الأكواب', idea: 'عرض خاص', score: 10 },
    ], { format: 'IMAGE_STORY', formal: false, history: ['كوب مطبوع بصورة العائلة على طاولة الإفطار'], recentAngles: [] });
    expect(r[0].title).toBe('كوب الصباح لمعلمتك');
    expect(r.find((x) => x.title.startsWith('خصم'))!.notes.join()).toMatch(/ادعاء/);
    expect(r.find((x) => x.title === 'كوب العائلة')!.parts.novelty).toBeLessThan(0.3);
  });
  it('humour is penalised on formal accounts only', () => {
    const funny = { ...base, title: 'موظف نعسان', idea: 'رسم كرتوني مضحك لموظف يركض خلف القهوة' };
    const elegant = { ...base, title: 'رول أب أنيق', idea: 'رول أب في معرض شركات بإضاءة راقية', score: 6 };
    expect(scoreConcepts([funny, elegant], { formal: true, history: [], recentAngles: [] })[0].title).toBe('رول أب أنيق');
    expect(scoreConcepts([funny, elegant], { formal: false, history: [], recentAngles: [] })[0].title).toBe('موظف نعسان');
    expect(jaccard('كوب مطبوع جميل', 'كوب مطبوع جميل')).toBe(1);
  });
});
