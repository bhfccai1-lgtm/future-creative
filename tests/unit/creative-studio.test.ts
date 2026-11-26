import { describe, expect, it } from 'vitest';
import { studioReadiness } from '@/lib/creative/studio-readiness';

describe('creative studio readiness gauge', () => {
  const base = { qualityByFormat: {} };
  it('defaults are counted as on; references, guidance and best-of are the remaining steps, in that order', () => {
    const r = studioReadiness(base);
    expect(r.pct).toBe(63);
    expect(r.missing).toEqual(['ارفع تصميمًا مرجعيًا لصيغتين على الأقل', 'اكتب توجيهًا دائمًا واضحًا للمصمم', 'اجعل المخرج الفني يختار من صورتين']);
  });
  it('a full professional set-up reaches 100 %', () => {
    const r = studioReadiness({ ...base, styleReferenceKey: 'k', styleRefsByFormat: { vertical: { key: 'v', brief: '' } }, ownerGuidance: 'ألوان دافئة وأبرز ملمس المنتج دائمًا', bestOf: 2 });
    expect(r).toEqual({ pct: 100, missing: [] });
  });
  it('switching a quality step off or lowering the bar shows up as a missing step', () => {
    const r = studioReadiness({ ...base, photoFinish: false, adScore: { enabled: true, threshold: 80, maxRedraws: 1 }, aiFullTextRetries: 0 });
    expect(r.missing).toEqual(expect.arrayContaining(['فعّل «تنقيح الاستوديو»', 'فعّل مؤشر الجودة بمعيار 90 أو أكثر', 'فعّل تصحيح الإملاء مرة على الأقل']));
  });
});
