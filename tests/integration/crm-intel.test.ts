import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { setAiProviderOverride } from '@/lib/ai';
import { createLead, updateLead } from '@/lib/leads/service';
import { customerKey, customerProfiles, priorProfile, scoreLead, smartReply, todayPriorities } from '@/lib/leads/intel';
import { runReadTool } from '@/lib/assistant/agent';
import { captureQueues, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });
const NOW = new Date('2026-11-20T09:00:00Z');
const base = { status: 'NEW', source: 'comment', need: '', createdAt: new Date(NOW.getTime() - 3 * 86400_000) };

describe('🧠 smart CRM', () => {
  it('scores real signals and explains them; tiers hot / warm / cold', () => {
    const hot = scoreLead({ ...base, source: 'whatsapp', need: 'ابي 150 كوب بشعار الشركة ضروري قبل الخميس', createdAt: NOW }, null, NOW);
    expect(hot.tier).toBe('hot'); expect(hot.reasons).toEqual(expect.arrayContaining(['يريدها بسرعة', 'كمية 150', 'طلب جديد اليوم']));
    const warm = scoreLead({ ...base, status: 'QUOTED', need: 'بطاقات أعمال' }, null, NOW);
    expect(warm.tier).toBe('warm'); expect(warm.reasons).toContain('استلم عرض سعر');
    const cold = scoreLead({ ...base, need: 'استفسار', createdAt: new Date(NOW.getTime() - 20 * 86400_000) }, null, NOW);
    expect(cold.tier).toBe('cold');
    const repeat = scoreLead({ ...base, need: 'استفسار' }, { key: 'k', requests: 2, won: 2, lost: 0, lifetimeBhd: 60, lastWonAt: NOW, firstSeen: NOW }, NOW);
    expect(repeat.score).toBeGreaterThan(scoreLead({ ...base, need: 'استفسار' }, null, NOW).score);
    expect(repeat.reasons[0]).toMatch(/عميل سابق \(2 طلب\)/);
  });

  it('recognises the same customer however the number was typed; a first request is not a repeat customer', async () => {
    const { admin } = await seedBase(); const actor = { sub: admin.id, email: admin.email };
    const old = await createLead({ name: 'سارة', contact: '+973 3331 6319', need: '50 كوب', source: 'whatsapp' }, actor);
    await updateLead(old.id, { status: 'WON', valueBhd: '42.5' }, actor);
    const again = await createLead({ name: 'سارة', contact: '33316319', need: 'ملصقات للمحل', source: 'phone' }, actor);
    expect(customerKey('+973 3331 6319')).toBe(customerKey('33316319'));
    const map = await customerProfiles([again.contact]);
    const p = map.get(customerKey(again.contact)!);
    expect(p).toMatchObject({ requests: 2, won: 1, lifetimeBhd: 42.5 });
    expect(priorProfile(p, again)).toMatchObject({ requests: 1, won: 1 });
    const fresh = await createLead({ name: 'جديد', contact: '36000000', need: 'استفسار', source: 'phone' }, actor);
    expect(priorProfile((await customerProfiles([fresh.contact])).get(customerKey(fresh.contact)!), fresh)?.won).toBe(0);
  });

  it('today: the hot and overdue requests come first; the assistant can read the list', async () => {
    const { admin } = await seedBase(); const actor = { sub: admin.id, email: admin.email };
    await createLead({ name: 'بارد', need: 'استفسار عام', source: 'comment' }, actor);
    const hot = await createLead({ name: 'ساخن', contact: '39000001', need: 'ابي 200 تيشيرت لفعالية الشركة ضروري', source: 'whatsapp' }, actor);
    const list = await todayPriorities();
    expect(list[0].id).toBe(hot.id); expect(list[0].tier).toBe('hot');
    const viaAssistant = (await runReadTool('hot_leads', {})) as { customer: string }[];
    expect(viaAssistant[0].customer).toBe('ساخن');
  });

  it('smart reply: the AI writes from the customer\'s words; without a key the ready script is used', async () => {
    const { admin } = await seedBase(); const actor = { sub: admin.id, email: admin.email };
    const l = await createLead({ name: 'أحمد', contact: '33445566', need: 'ابي 100 كرت شخصي', source: 'whatsapp' }, actor);
    expect((await smartReply(l.id)).source).toBe('script'); // dry-run settings → no AI call
    await prisma.systemSetting.deleteMany({});
    const { updateSettings } = await import('@/lib/settings');
    await updateSettings((s) => ({ ...s, ai: { ...s.ai, dryRun: false } }));
    class Writer extends FakeAiProvider { seen = ''; async generateJson(_s: string, user: string) { this.seen = user; return { json: { text: 'هلا أحمد 👋 وصلنا طلبك لـ 100 كرت شخصي، تبي نفس تصميمك الحالي ولا نصمم لك جديد؟' }, usage: { inputTokens: 300, outputTokens: 60 }, model: 'fake-text' }; } }
    const ai = new Writer(); setAiProviderOverride(ai);
    const r = await smartReply(l.id);
    expect(r.source).toBe('ai'); expect(r.text).toMatch(/100 كرت/);
    expect(ai.seen).toMatch(/ابي 100 كرت شخصي/);
    expect(await prisma.aiUsage.count({ where: { kind: 'text' } })).toBe(1);
  });
});

describe('quantity is not confused with a size or a price', () => {
  it('counts «150 كوب» and «ابي 200», not «رول أب 850 فلس» or «85×200»', () => {
    const r = (need: string) => scoreLead({ ...base, need }, null, NOW).reasons;
    expect(r('ابي 150 كوب')).toContain('كمية 150');
    expect(r('ابي 200 للحفل')).toContain('كمية 200');
    expect(r('رول أب 850 فلس').some((x) => x.startsWith('كمية'))).toBe(false);
    expect(r('بنر 85×200').some((x) => x.startsWith('كمية'))).toBe(false);
  });
});
