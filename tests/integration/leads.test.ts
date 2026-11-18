import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createLead, followUpReminder, leadsFromComments, leadStats, parseBhd, summarize, updateLead } from '@/lib/leads/service';
import { captureQueues, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });
const actor = { sub: '', email: 'admin@test.bh' };

describe('leads & orders', () => {
  it('order / price comments become one lead each (idempotent); praise does not', async () => {
    const { accounts, admin } = await seedBase(); actor.sub = admin.id;
    await prisma.socialComment.createMany({ data: [
      { accountId: accounts[0].id, username: 'sara', text: 'بكم الكوب المطبوع؟', category: 'price' },
      { accountId: accounts[0].id, username: 'ali', text: 'ابي 50 كوب بشعار الشركة', category: 'order' },
      { accountId: accounts[1].id, username: 'x', text: 'روعة 😍', category: 'praise' },
    ] });
    expect(await leadsFromComments()).toBe(2);
    expect(await leadsFromComments()).toBe(0);
    const l = await prisma.lead.findFirstOrThrow({ where: { name: '@ali' } });
    expect(l).toMatchObject({ source: 'comment', status: 'NEW', accountId: accounts[0].id });
  });

  it('follow the pipeline: contact → quote → won with value; lost needs a reason; stats per account', async () => {
    const { accounts, admin } = await seedBase(); actor.sub = admin.id;
    const a = await createLead({ need: '100 بطاقة عمل', source: 'phone', accountId: accounts[0].id }, actor);
    const t0 = new Date();
    const c = await updateLead(a.id, { status: 'CONTACTED' }, actor, t0);
    expect(c.firstContactAt).toEqual(t0);
    expect(c.nextFollowUpAt!.getTime()).toBe(t0.getTime() + 2 * 86400_000);
    await updateLead(a.id, { status: 'QUOTED' }, actor);
    const w = await updateLead(a.id, { status: 'WON', valueBhd: '45.500 د.ب' }, actor);
    expect(w).toMatchObject({ status: 'WON', valueBhd: 45.5, nextFollowUpAt: null });
    const b = await createLead({ need: 'رول أب', source: 'whatsapp', accountId: accounts[1].id }, actor);
    const lost = await updateLead(b.id, { status: 'LOST', lostReason: '' }, actor);
    expect(lost.lostReason).toBe('أخرى');
    const s = await leadStats(30);
    expect(s).toMatchObject({ total: 2, won: 1, lost: 1, revenue: 45.5, conversion: 50 });
    expect(s.byAccount[0]).toMatchObject({ accountId: accounts[0].id, won: 1, revenue: 45.5 });
    expect(await prisma.auditLog.count({ where: { action: 'lead.update' } })).toBe(4);
  });

  it('daily reminder lists customers due for follow-up', async () => {
    const { admin } = await seedBase(); actor.sub = admin.id;
    await createLead({ need: 'ستيكرات', source: 'walkin' }, actor);
    expect(await followUpReminder(new Date(Date.now() + 60_000))).toEqual({ due: 1 });
    expect(await prisma.notification.count({ where: { code: 'LEADS_FOLLOW_UP' } })).toBe(1);
  });

  it('parses order values typed in Arabic', () => {
    expect(['45.500 د.ب', '٤٥٫٥', 'BD 12', '', 'لا'].map(parseBhd)).toEqual([45.5, 45.5, 12, null, null]);
  });

  it('summary flags slow first replies and computes the median', () => {
    const now = new Date('2026-11-18T12:00:00Z');
    const base = { source: 'comment', accountId: null, valueBhd: null, lostReason: null, nextFollowUpAt: null };
    const s = summarize([
      { ...base, status: 'NEW', createdAt: new Date('2026-11-18T08:00:00Z'), firstContactAt: null },
      { ...base, status: 'CONTACTED', createdAt: new Date('2026-11-18T08:00:00Z'), firstContactAt: new Date('2026-11-18T09:00:00Z') },
      { ...base, status: 'WON', createdAt: new Date('2026-11-17T08:00:00Z'), firstContactAt: new Date('2026-11-17T11:00:00Z') },
    ], {}, now);
    expect(s).toMatchObject({ slowNew: 1, open: 2, medianHoursToContact: 3, conversion: 100 });
  });
});

describe('sales layer', () => {
  it('logging WhatsApp messages advances the stage; quotes are numbered and set the expected value', async () => {
    const { admin } = await seedBase(); actor.sub = admin.id;
    const { recordTouch, saveQuote } = await import('@/lib/leads/service');
    const a = await createLead({ need: '50 كوب', source: 'phone', contact: '36001122' }, actor);
    const t1 = await recordTouch(a.id, 'first_reply', actor);
    expect(t1.status).toBe('CONTACTED');
    const q = await saveQuote(a.id, { items: [{ desc: 'كوب مطبوع', qty: 50, unit: 1.8 }, { desc: '', qty: 1, unit: 1 }], discount: 5 }, actor);
    expect(q).toMatchObject({ status: 'QUOTED', quoteNo: 1001, valueBhd: 85 });
    const again = await saveQuote(a.id, { items: [{ desc: 'كوب مطبوع', qty: 60, unit: 1.8 }] }, actor);
    expect(again.quoteNo).toBe(1001); // editing keeps the number
    const b = await createLead({ need: 'رول أب', source: 'walkin' }, actor);
    expect((await saveQuote(b.id, { items: [{ desc: 'رول أب', qty: 2, unit: 15 }] }, actor)).quoteNo).toBe(1002);
    await expect(saveQuote(b.id, { items: [{ desc: '  ', qty: 0, unit: 1 }] }, actor)).rejects.toThrow(/بندًا/);
    const sent = await recordTouch(a.id, 'quote_send', actor);
    expect((sent.touches as unknown[]).length).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: 'lead.touch' } })).toBe(2);
  });

  it('month vs target, open-quote pipeline, and past customers due for a new offer (not those who came back)', async () => {
    const { admin } = await seedBase({ settings: (s) => ({ ...s, sales: { ...s.sales, monthlyTargetBhd: 1000 } }) }); actor.sub = admin.id;
    const { salesOverview, saveQuote } = await import('@/lib/leads/service');
    const w = await createLead({ need: 'أكواب', source: 'phone', contact: '36001122' }, actor);
    await updateLead(w.id, { status: 'WON', valueBhd: 250 }, actor);
    const q = await createLead({ need: 'بنر', source: 'phone' }, actor);
    await saveQuote(q.id, { items: [{ desc: 'بنر', qty: 1, unit: 40 }] }, actor);
    const old = await createLead({ need: 'دفاتر', source: 'phone', contact: '39998877' }, actor);
    await prisma.lead.update({ where: { id: old.id }, data: { status: 'WON', wonAt: new Date(Date.now() - 90 * 86400_000) } });
    const back = await createLead({ need: 'ستيكرات', source: 'phone', contact: '38887766' }, actor);
    await prisma.lead.update({ where: { id: back.id }, data: { status: 'WON', wonAt: new Date(Date.now() - 90 * 86400_000), createdAt: new Date(Date.now() - 95 * 86400_000) } });
    await createLead({ need: 'طلب جديد', source: 'phone', contact: '38887766' }, actor); // this customer already returned
    const o = await salesOverview();
    expect(o.month).toMatchObject({ revenue: 250, won: 1, target: 1000, pct: 25 });
    expect(o.pipeline).toMatchObject({ quotes: 1, value: 40 });
    expect(o.reactivate.map((r) => r.id)).toEqual([old.id]);
  });
});
