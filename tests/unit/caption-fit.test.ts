import { describe, expect, it } from 'vitest';
import { fitCaption, splitCaption, weightedLength } from '@/lib/publishing/caption';
import { MetricoolAdapter } from '@/lib/publishing/metricool';

const contact = '📞 سار 33316319 | سلماباد 34315316';
const longCaption = ['☕✨ كوبك بتصميمك الخاص!', ...Array.from({ length: 30 }, (_, i) => `سطر فائدة رقم ${i + 1} يشرح لماذا الطباعة المخصصة مميزة للهدايا والمناسبات`), 'اطلب الآن', '', Array.from({ length: 40 }, (_, i) => `#وسم${i}`).join(' ')].join('\n');

describe('per-network caption fitting', () => {
  it('X (280): keeps the hook and the verified contact line, max 2 hashtags', () => {
    const r = fitCaption(longCaption, contact, ['instagram', 'twitter']);
    expect(weightedLength(r.text)).toBeLessThanOrEqual(280);
    expect(r.text.startsWith('☕✨ كوبك بتصميمك الخاص!')).toBe(true);
    expect(r.text).toContain('33316319'); expect(r.text).toContain('34315316');
    expect(r.text.match(/#/g)?.length).toBeLessThanOrEqual(2);
  });
  it('Instagram alone: ≤ 2200 chars and ≤ 5 hashtags (current Instagram cap)', () => {
    const r = fitCaption(longCaption, contact, ['instagram']);
    expect(weightedLength(r.text)).toBeLessThanOrEqual(2200);
    expect(r.text.match(/#/g)?.length).toBe(5);
    expect(r.text).toContain('33316319');
  });
  it('short captions are untouched; hashtags can move to the first comment', () => {
    const c = 'كوبك بتصميمك ☕\nاطلب الآن\n\n#البحرين #طباعة_أكواب';
    expect(fitCaption(c, contact, ['instagram']).text).toBe(`كوبك بتصميمك ☕\nاطلب الآن\n\n${contact}\n\n#البحرين #طباعة_أكواب`);
    const sep = fitCaption(c, contact, ['instagram'], { hashtagsSeparately: true });
    expect(sep.text).not.toContain('#'); expect(sep.hashtags).toEqual(['#البحرين', '#طباعة_أكواب']);
    expect(splitCaption(c).hashtags).toHaveLength(2);
  });
});

describe('Metricool body details (verified against real Metricool posts)', () => {
  const a = new MetricoolAdapter({ token: 't', userId: '1', baseUrl: 'https://x', fetchImpl: fetch });
  const base = { idempotencyKey: 'k', providerBrandId: '1', publishAt: new Date('2026-12-01T07:00:00Z'), timezone: 'Asia/Bahrain', text: 'نص الإعلان', mediaUrls: ['https://ads/api/m/1/s/ads/a/final.jpg'], aiGenerated: true, altText: 'كوب مطبوع' };
  it('story-only posts carry no caption (as in the brand’s published stories)', () => {
    const b = a.buildBody({ ...base, networks: ['instagram'], format: 'IMAGE_STORY' });
    expect(b.text).toBe(''); expect(b.instagramData).toMatchObject({ type: 'STORY' });
  });
  it('feed/reel posts keep caption, alt text and first comment', () => {
    const b = a.buildBody({ ...base, networks: ['instagram'], format: 'IMAGE_FEED', firstComment: '#البحرين' });
    expect(b.text).toBe('نص الإعلان'); expect(b.mediaAltText).toEqual(['كوب مطبوع']); expect(b.firstCommentText).toBe('#البحرين');
  });
});
