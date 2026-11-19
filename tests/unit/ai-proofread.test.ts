import { describe, expect, it } from 'vitest';
import { applyProofIssues, proofSummary } from '@/lib/creative/ai-proofread';

describe('AI proofreading — only safe fixes are applied', () => {
  const copy = { headline: 'هدية مميزه لأحبابك', caption: 'اطلب كوبك الحين\nنطبع اي تصميم' };
  it('applies a small exact fix and keeps everything else', () => {
    const r = applyProofIssues(copy, { issues: [{ field: 'headline', wrong: 'مميزه', fix: 'مميزة', reason: 'تاء مربوطة' }] });
    expect(r.copy.headline).toBe('هدية مميزة لأحبابك');
    expect(r.copy.caption).toBe(copy.caption);
    expect(r.applied).toHaveLength(1); expect(r.flagged).toHaveLength(0);
  });
  it('ignores invented text, flags rewrites and new numbers instead of applying them', () => {
    const r = applyProofIssues(copy, { issues: [
      { field: 'caption', wrong: 'غير موجود', fix: 'x', reason: '' }, // not in the text → ignored
      { field: 'caption', wrong: 'نطبع اي تصميم', fix: 'نقدم لكم أفضل التصاميم الاحترافية', reason: 'أسلوب' }, // a rewrite → flagged
      { field: 'headline', wrong: 'لأحبابك', fix: 'لأحبابك 50', reason: '' }, // adds a number → flagged
      { field: 'nope', wrong: 'a', fix: 'b' }, // unknown field → ignored
    ] });
    expect(r.copy).toEqual(copy);
    expect(r.applied).toHaveLength(0); expect(r.flagged).toHaveLength(2);
    expect(proofSummary(r)).toContain('للمراجعة');
  });
  it('a malformed model answer changes nothing', () => {
    expect(applyProofIssues(copy, 'garbage').copy).toEqual(copy);
    expect(applyProofIssues(copy, { issues: 'x' }).applied).toEqual([]);
  });
});
