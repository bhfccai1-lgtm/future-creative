import { describe, expect, it } from 'vitest';
import { cadence, captionStats, hashtagStats, scoreOf } from '@/lib/ops/social-audit';

describe('platform expert rules (Instagram guidance, measured on real posts)', () => {
  it('hashtags: average, none / more than 10, and the exact same set repeated', () => {
    const s = hashtagStats([['#مطبعة', '#البحرين', '#هدايا'], ['هدايا', 'البحرين', 'مطبعة'], Array.from({ length: 15 }, (_, i) => `#t${i}`), []]);
    expect(s).toMatchObject({ n: 4, zeroPct: 25, over10Pct: 25, sameSetPct: 50 }); // the first two are the same set (order/# ignored)
    expect(s.avg).toBe(5.3);
  });
  it('captions: hook within 125 characters, a search keyword up front, a call to action (Arabic, English, Hindi)', () => {
    const c = captionStats([
      { caption: 'أكواب مطبوعة بالاسم في البحرين ☕\nتفاصيل…\nاطلب الآن عبر واتساب', keywords: ['أكواب مطبوعة', 'Mugs'] },
      { caption: `${'ل'.repeat(140)}\nبدون دعوة`, keywords: ['أكواب'] },
      { caption: 'Custom mugs with your name\nOrder on WhatsApp', keywords: ['أكواب', 'Custom mugs'] },
      { caption: 'अपना नाम लिखवाएं — कस्टम मग\nअभी ऑर्डर करें', keywords: ['कस्टम मग'] },
    ]);
    expect(c).toEqual({ n: 4, hookPct: 75, keywordPct: 75, ctaPct: 75 });
  });
  it('cadence: posts per week and the longest silence (window edges included)', () => {
    const now = new Date('2026-11-25T00:00:00Z'), d = (n: number) => new Date(now.getTime() - n * 86400_000);
    expect(cadence([d(28), d(21), d(14), d(7), d(1)], 28, now)).toEqual({ perWeek: 1.3, maxGapDays: 7 });
    expect(cadence([], 30, now)).toEqual({ perWeek: 0, maxGapDays: 30 });
  });
  it('score counts only judged checks', () => {
    const c = (status: 'good' | 'warn' | 'bad' | 'na') => ({ id: status, label: '', status, value: '', benchmark: '' });
    expect(scoreOf([c('good'), c('warn'), c('bad'), c('na')])).toBe(50);
    expect(scoreOf([c('na')])).toBeNull();
  });
});
