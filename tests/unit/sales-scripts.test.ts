import { describe, expect, it } from 'vitest';
import { nextAction, quoteTotals, scriptText, waLink, waNumber, type LeadLike, type Quote } from '@/lib/leads/scripts';

const ctx = { business: 'مطبعة إبداع المستقبل', branches: [{ label: 'فرع سار', phone: '33316319' }, { label: 'فرع سلماباد', phone: '34315316' }], reactivationDays: 60 };
const now = new Date('2026-11-18T09:00:00Z');
const days = (n: number) => new Date(now.getTime() - n * 86400_000);
const lead = (o: Partial<LeadLike> = {}): LeadLike => ({ name: 'أم محمد', contact: '36001122', need: '50 كوب مطبوع بشعار الشركة', status: 'NEW', createdAt: days(0), ...o });
const quote: Quote = { no: 1001, items: [{ desc: 'كوب سيراميك مطبوع', qty: 50, unit: 1.8 }], discount: 5, notes: '', validUntil: new Date(now.getTime() + 7 * 86400_000).toISOString(), at: days(3).toISOString() };

describe('sales playbook', () => {
  it('WhatsApp numbers: Bahrain local → 973, international kept, handles and junk → none', () => {
    expect(waNumber('3600 1122')).toBe('97336001122');
    expect(waNumber('+973 3331 6319')).toBe('97333316319');
    expect(waNumber('٣٦٠٠١١٢٢')).toBe('97336001122');
    expect(waNumber('00966501234567')).toBe('966501234567');
    expect(waNumber('@sara')).toBeNull();
    expect(waLink('@sara', 'x')).toBeNull();
    expect(waLink('36001122', 'هلا')).toBe('https://wa.me/97336001122?text=%D9%87%D9%84%D8%A7');
  });
  it('quote totals with a discount that can never exceed the subtotal', () => {
    expect(quoteTotals(quote)).toEqual({ subtotal: 90, discount: 5, total: 85 });
    expect(quoteTotals({ items: quote.items, discount: 500 }).total).toBe(0);
  });
  it('next action follows the stage: first reply → quote → follow-ups on day 2 and 5 → thanks → reactivation', () => {
    expect(nextAction(lead(), ctx, now)?.key).toBe('first_reply');
    expect(nextAction(lead({ status: 'CONTACTED' }), ctx, now)).toBeNull();
    expect(nextAction(lead({ status: 'QUOTED', quote }), ctx, now)?.key).toBe('quote_send');
    const sent = [{ key: 'quote_send' as const, at: days(3).toISOString(), by: 'a' }];
    expect(nextAction(lead({ status: 'QUOTED', quote, touches: sent }), ctx, now)).toMatchObject({ key: 'follow_1', due: true });
    const f1 = [...sent, { key: 'follow_1' as const, at: days(1).toISOString(), by: 'a' }];
    expect(nextAction(lead({ status: 'QUOTED', quote, touches: f1 }), ctx, now)).toMatchObject({ key: 'follow_2', due: false });
    expect(nextAction(lead({ status: 'WON', wonAt: days(1) }), ctx, now)?.key).toBe('won_thanks');
    const thanked = [{ key: 'won_thanks' as const, at: days(70).toISOString(), by: 'a' }];
    expect(nextAction(lead({ status: 'WON', wonAt: days(70), touches: thanked }), ctx, now)?.key).toBe('reactivate');
    expect(nextAction(lead({ status: 'WON', wonAt: days(10), touches: thanked }), ctx, now)).toBeNull();
    expect(nextAction(lead({ status: 'LOST', closedAt: days(40), lostReason: 'السعر' }), ctx, now)?.key).toBe('reengage');
    expect(nextAction(lead({ status: 'LOST', closedAt: days(40), lostReason: 'لم يرد' }), ctx, now)).toBeNull();
  });
  it('messages use the customer name and need; prices appear only in the quote message', () => {
    const t = scriptText('first_reply', lead(), ctx);
    expect(t).toContain('هلا أم محمد،'); expect(t).toContain('50 كوب'); expect(t).not.toMatch(/د\.ب|\d+\.\d{3}/);
    expect(scriptText('quote_send', lead({ quote }), ctx)).toContain('85.000 د.ب');
    for (const k of ['follow_1', 'follow_2', 'won_thanks', 'reactivate', 'reengage'] as const) expect(scriptText(k, lead(), ctx)).not.toMatch(/خصم|مجان|أرخص|الأفضل/);
    expect(scriptText('first_reply', lead({ name: 'John', need: '100 business cards' }), ctx)).toMatch(/^Hi John/);
    expect(scriptText('first_reply', lead({ name: '@sara_99' }), ctx)).toMatch(/^هلا sara_99/);
  });
});
