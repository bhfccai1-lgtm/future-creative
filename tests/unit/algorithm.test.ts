import { describe, expect, it } from 'vitest';
import { algoInputFromAd, algorithmScore, baitPhrases, stripBait } from '@/lib/growth/algorithm';

const good = 'تبي هدية تفرّح؟ أكواب مطبوعة بتصميمك في البحرين ☕\nصورتك أو اسمك على كوب يومي.\nأرسلها لأحد يجهّز لمناسبة 🎁\nاطلب الآن 📞 فرع سار 33316319';
describe('algorithm readiness', () => {
  it('engagement bait is detected and removed, genuine questions are kept', () => {
    const c = 'وش رأيكم بهذا التصميم؟\nمنشن صديقك اللي يحب القهوة\nاكتب «نعم» إذا تبي واحد\nTag a friend who needs this\nlike if you agree\nاطلب الآن';
    expect(baitPhrases(c)).toHaveLength(4);
    expect(stripBait(c)).toBe('وش رأيكم بهذا التصميم؟\nاطلب الآن');
    expect(baitPhrases(good)).toHaveLength(0);
  });
  it('a well-built reel scores A; the same idea as a bait-filled story scores low with concrete tips', () => {
    const reel = algorithmScore({ format: 'REEL_VIDEO', caption: good, headline: 'فكرتك على كوب!', hashtags: ['#البحرين', '#أكواب_مطبوعة', '#هدايا'], reelSeconds: 10, keywords: ['أكواب مطبوعة'], hour: 20, peakHours: [20, 21] });
    expect(reel.grade).toBe('A');
    expect(reel.signals.every((s) => s.ok)).toBe(true);
    const bad = algorithmScore({ format: 'IMAGE_STORY', caption: 'منشن صديقك\n' + 'ن'.repeat(130), headline: 'أفضل مطبعة في كل المملكة لجميع أنواع الطباعة', hashtags: [], keywords: ['أكواب مطبوعة'], duplicate: true, hour: 3, peakHours: [20, 21] });
    expect(bad.score).toBeLessThan(30);
    const tips = bad.signals.filter((s) => !s.ok).map((s) => s.id);
    expect(tips).toEqual(expect.arrayContaining(['reach_format', 'hook', 'no_bait', 'search_keyword', 'search_location', 'original', 'timing', 'hashtags', 'sends_saves']));
    expect(bad.signals.find((s) => s.id === 'no_bait')?.tip).toContain('منشن صديقك');
  });
  it('carousel depth and keyword matching across spelling variants', () => {
    const a = algorithmScore({ format: 'IMAGE_CAROUSEL', caption: 'اكواب مطبوعه للهدايا في البحرين\nاحفظها لطلبك القادم', headline: '5 أفكار هدايا', hashtags: ['#a', '#b', '#c'], slides: 5, keywords: ['أكواب مطبوعة'] });
    expect(a.signals.find((s) => s.id === 'search_keyword')?.ok).toBe(true);
    expect(a.signals.find((s) => s.id === 'carousel_depth')?.ok).toBe(true);
    expect(a.signals.some((s) => s.id === 'timing')).toBe(false); // unknown hour → not scored
  });
  it('builds the input from a stored design', () => {
    const i = algoInputFromAd({ format: 'REEL_VIDEO', caption: good, headline: 'فكرتك على كوب!', language: 'ar', options: { reelDuration: 10 }, qcReport: { checks: [{ id: 'duplicates', passed: false }] },
      brief: { hashtags: ['#x'] }, product: { titleAr: 'أكواب مطبوعة', titleEn: 'Printed mugs' }, jobs: [{ scheduledFor: new Date('2026-11-18T17:00:00Z'), primary: true }] }, [20]);
    expect(i).toMatchObject({ reelSeconds: 10, duplicate: true, keywords: ['أكواب مطبوعة'], hour: 20, hashtags: ['#x'] });
  });
});
