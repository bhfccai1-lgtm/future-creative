import { describe, expect, it } from 'vitest';
import { classifyComment, templateReply, replyIssues, parsePasted } from '@/lib/comments/classify';

const ctx = { username: 'sara.bh', phones: [{ label: 'فرع سار', phone: '33316319' }, { label: 'فرع سلماباد', phone: '34315316' }], cta: 'اطلب الآن' };
describe('comment triage rules', () => {
  it.each([
    ['بكم الكوب؟', 'price', true], ['ابي اطلب ٥٠ كوب للمدرسة', 'order', true], ['وين موقعكم؟', 'info', false],
    ['ماشاءالله روعة 😍', 'praise', false], ['الطلب تأخر وما وصل لين الحين', 'complaint', true], ['check my page http://x.co', 'spam', false],
    ['how much for 100 stickers?', 'price', true], ['Beautiful work 🔥', 'praise', false], ['👍', 'other', false],
  ])('%s → %s', (t, cat, urgent) => {
    const r = classifyComment(t);
    expect(r.category).toBe(cat); expect(r.urgent).toBe(urgent);
  });
  it('sentiment and language', () => {
    expect(classifyComment('سيء جدا').sentiment).toBe('negative');
    expect(classifyComment('nice').language).toBe('en');
    expect(classifyComment('നല്ലത്').language).toBe('ml');
  });
  it('templates are safe, mention the user and carry only the official phones', () => {
    for (const c of ['order', 'price', 'info', 'praise', 'complaint', 'other'] as const) for (const lang of ['ar', 'en']) {
      const r = templateReply(c, lang, ctx);
      expect(r).toContain('@sara.bh');
      expect(replyIssues(r, ['33316319', '34315316'])).toEqual([]);
    }
    expect(templateReply('spam', 'ar', ctx)).toBe('');
  });
  it('flags unsafe replies', () => {
    const allowed = ['33316319', '34315316'];
    expect(replyIssues('خصم 20% اليوم فقط', allowed).join()).toMatch(/ممنوع/);
    expect(replyIssues('السعر 5 دينار', allowed).join()).toMatch(/ممنوع/);
    expect(replyIssues('كلمنا 39998877', allowed).join()).toMatch(/رقم غير رسمي/);
    expect(replyIssues('نوصل خلال 2 يوم', allowed).join()).toMatch(/ممنوع/);
    expect(replyIssues('كلّمنا: فرع سار 33316319', allowed)).toEqual([]);
  });
  it('parses pasted comments', () => {
    expect(parsePasted('sara.bh: بكم الكوب؟\n@ali_99 روعة\nبدون اسم هنا\n\n')).toEqual([
      { username: 'sara.bh', text: 'بكم الكوب؟' }, { username: 'ali_99', text: 'روعة' }, { username: null, text: 'بدون اسم هنا' },
    ]);
  });
});
