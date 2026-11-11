import { describe, expect, it } from 'vitest';
import { fitText, normalizeBrief } from '@/lib/ai/brief-normalize';
describe('brief normalisation', () => {
  it('cuts at a word boundary and removes trailing punctuation', () => {
    expect(fitText('كوب مطبوع بتصميمك الخاص، هدية مميزة', 20)).toBe('كوب مطبوع بتصميمك');
    expect(fitText('short', 30)).toBe('short');
  });
  it('captions lose whole trailing lines, never half a sentence', () => {
    const cap = ['سطر أول', 'سطر ثان', 'x'.repeat(1795)].join('\n');
    expect(normalizeBrief({ caption: cap }, 'اطلب الآن').brief.caption).toBe('سطر أول\nسطر ثان');
  });
  it('missing CTA → official CTA; adjusted fields are reported', () => {
    const r = normalizeBrief({ headline: 'ع'.repeat(70) }, 'اطلب الآن');
    expect(r.brief.cta).toBe('اطلب الآن'); expect(r.adjusted).toContain('headline');
  });
});
