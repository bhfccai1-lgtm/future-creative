import { describe, expect, it } from 'vitest';
import { algoInputFromAd, algorithmScore, baitPhrases, fitToAlgorithm, stripBait } from '@/lib/growth/algorithm';

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

describe('algorithm gate (design built to the index)', () => {
  it('fixes a weak caption: bait, keyword + place, send line, hashtags — and raises the score', () => {
    const r = fitToAlgorithm({
      format: 'IMAGE_FEED', lang: 'ar', headline: 'هديتك بطابعك',
      caption: 'هدية تفرّح أي أحد 🎁\nصمّم كوبك بصورتك\nمنشن صديقك اللي يستاهل\n\nاطلب الحين 📞 سار 33316319',
      hashtags: ['هدايا'], keyword: 'أكواب مطبوعة', market: 'BH',
    });
    expect(r.caption).not.toContain('منشن');
    expect(r.caption.split('\n')[1]).toBe('✨ أكواب مطبوعة في البحرين');
    expect(r.caption).toContain('أرسلها لأحد يحتاجها');
    // the send line sits before the CTA paragraph
    expect(r.caption.indexOf('أرسلها')).toBeLessThan(r.caption.indexOf('اطلب الحين'));
    expect(r.hashtags.length).toBeGreaterThanOrEqual(3);
    expect(r.hashtags.length).toBeLessThanOrEqual(5);
    expect(r.after).toBeGreaterThan(r.before);
    expect(r.after).toBeGreaterThanOrEqual(70);
    expect(r.fixes.length).toBeGreaterThanOrEqual(3);
  });
  it('leaves a caption that already fits untouched', () => {
    const caption = 'أكواب مطبوعة في البحرين بصورتك ☕\nأرسلها لأحد يجهّز لمناسبة\n\nاطلب الحين';
    const r = fitToAlgorithm({ format: 'REEL_VIDEO', lang: 'ar', headline: 'فكرتك على كوب', caption, hashtags: ['#البحرين', '#أكواب_مطبوعة', '#هدايا'], keyword: 'أكواب مطبوعة', reelSeconds: 10 });
    expect(r.caption).toBe(caption);
    expect(r.fixes).toEqual([]);
    expect(r.grade).toBe('A');
  });
  it('splits a first line longer than 125 characters and uses the Saudi place for KSA accounts', () => {
    const long = 'هذا سطر افتتاحي طويل جدًا يشرح الفكرة كاملة قبل أن يصل القارئ إلى أي شيء مفيد، ثم يكمل الكلام عن المنتج والمناسبة والتفاصيل الكثيرة التي لا تظهر قبل زر المزيد أبدًا';
    const r = fitToAlgorithm({ format: 'IMAGE_FEED', lang: 'ar', headline: 'هدية', caption: long, hashtags: [], keyword: 'تيشيرتات', market: 'KSA' });
    expect([...r.caption.split('\n')[0]].length).toBeLessThanOrEqual(125);
    expect(r.caption).toContain('السعودية');
    expect(r.caption).not.toContain('البحرين');
    expect(r.hashtags).not.toContain('#البحرين');
  });
  it('reports what cannot be fixed automatically (story format reach)', () => {
    const r = fitToAlgorithm({ format: 'IMAGE_STORY', lang: 'en', headline: 'Custom mugs', caption: 'Printed mugs in Bahrain\nSend this to someone who needs it', hashtags: ['#a', '#b', '#c'], keyword: 'Printed mugs' });
    expect(r.remaining.map((x) => x.id)).toContain('reach_format');
  });
});

describe('Saudi accounts never carry Bahrain hashtags', () => {
  it('removes #البحرين / #Bahrain / #هدايا_البحرين from tags and caption, keeps the branch phones, adds #السعودية', () => {
    const r = fitToAlgorithm({
      format: 'REEL_VIDEO', lang: 'ar', market: 'KSA', headline: 'قبعات الفريق', keyword: 'قبعات',
      caption: 'فريقك له هوية تبين من أول نظرة؟ #البحرين\nقبعات بطباعة تعكس روح الفريق\nأرسله لقائد فريقك\n\n📞 سار 33316319 | سلماباد 34315316',
      hashtags: ['#البحرين', '#طباعة_القبعات', '#Bahrain', '#هدايا_البحرين', '#قبعات_الفرق'], reelSeconds: 10,
    });
    expect(r.hashtags.join(' ')).not.toMatch(/بحرين|Bahrain/i);
    expect(r.hashtags).toContain('#السعودية');
    expect(r.caption).not.toContain('#البحرين');
    expect(r.caption).toContain('سار 33316319 | سلماباد 34315316');
    expect(r.fixes).toContain('حذف وسوم البحرين من حساب السعودية');
  });
  it('Bahrain accounts keep their tags', () => {
    const r = fitToAlgorithm({ format: 'REEL_VIDEO', lang: 'ar', market: 'BH', headline: 'كوب', caption: 'أكواب مطبوعة في البحرين\nأرسلها لأحد يحتاجها', hashtags: ['#البحرين', '#أكواب', '#هدايا'], keyword: 'أكواب مطبوعة', reelSeconds: 10 });
    expect(r.hashtags).toContain('#البحرين');
  });
});
