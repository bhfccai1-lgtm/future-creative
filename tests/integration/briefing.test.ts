import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { updateSettings } from '@/lib/settings';
import { setAiProviderOverride } from '@/lib/ai';
import { createLead } from '@/lib/leads/service';
import { briefText, buildBrief, latestBrief, rankActions, runMorningBrief, type Brief } from '@/lib/ops/briefing';
import { runReadTool } from '@/lib/assistant/agent';
import { captureQueues, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });
const zero: Brief['numbers'] = { pendingApprovals: 0, readyToPublish: 0, hotLeads: 0, overdueFollowUps: 0, revenue: 0, target: 0, trendIdeas: 0, aiSpendUsd: 0, aiBudgetUsd: 50, thinPages: 0 };

describe('☀️ morning brief', () => {
  it('ranks the three actions worth doing first, with links', () => {
    const a = rankActions({ ...zero, hotLeads: 2, overdueFollowUps: 3, readyToPublish: 4, trendIdeas: 2, thinPages: 9 }, { topLead: { name: 'سارة', score: 85 } });
    expect(a.map((x) => x.id)).toEqual(['leads', 'follow', 'publish']);
    expect(a[0]).toMatchObject({ link: '/leads', text: expect.stringMatching(/سارة.*85/) });
    expect(rankActions(zero)).toEqual([]); // a quiet day says so
    const critical = rankActions({ ...zero, readyToPublish: 1 }, { advisor: { title: 'القرص ممتلئ', severity: 'critical' } });
    expect(critical[0]).toMatchObject({ id: 'health', link: '/diagnostics' });
    expect(rankActions({ ...zero, aiSpendUsd: 45 })[0].id).toBe('budget');
  });

  it('builds from the real modules, keeps it for the dashboard, notifies; the assistant reads it', async () => {
    const { admin } = await seedBase();
    await createLead({ name: 'شركة الأمل', contact: '39000001', need: 'ابي 200 تيشيرت لفعالية الشركة ضروري', source: 'whatsapp' }, { sub: admin.id, email: admin.email });
    const b = await buildBrief();
    expect(b.numbers.hotLeads).toBe(1);
    expect(b.actions.find((x) => x.id === 'leads')).toMatchObject({ link: '/leads', text: expect.stringMatching(/شركة الأمل/) });
    expect(b.text).toMatch(/أهم ٣ خطوات اليوم/);
    const r = await runMorningBrief();
    expect(r).toMatchObject({ source: 'rules', whatsapp: 0 });
    expect((await latestBrief())?.actions.some((x) => x.id === 'leads')).toBe(true);
    expect(await prisma.notification.count({ where: { code: 'MORNING_BRIEF' } })).toBe(1);
    const viaAssistant = (await runReadTool('morning_brief', {})) as { priorities: string[] };
    expect(viaAssistant.priorities.some((t) => /شركة الأمل/.test(t))).toBe(true);
  });

  it('switched off → nothing; AI phrasing only when chosen, facts only; WhatsApp only when chosen', async () => {
    await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
    await updateSettings((s) => ({ ...s, briefing: { ...s.briefing, enabled: false } }));
    expect(await runMorningBrief()).toEqual({ skipped: true });
    await updateSettings((s) => ({ ...s, briefing: { enabled: true, aiWrite: true, whatsapp: true }, whatsapp: { ...s.whatsapp, cloud: { ...s.whatsapp.cloud, enabled: true, ownerNumbers: ['97333316319'] } } }));
    class Writer extends FakeAiProvider { async generateJson() { return { json: { text: 'صباح الخير يا بو محمد ☀️ اليوم هادئ — لا شيء عاجل، استمر على نفس الإيقاع 👌 وأي استفسار جديد بنبلغك فيه.' }, usage: { inputTokens: 300, outputTokens: 80 }, model: 'fake-text' }; } }
    setAiProviderOverride(new Writer());
    const sent: string[] = [];
    const r = await runMorningBrief(new Date(), async (to, text) => { sent.push(`${to}|${text}`); return { ok: true }; });
    expect(r).toMatchObject({ source: 'ai', whatsapp: 1 });
    expect(sent[0]).toMatch(/^97333316319\|صباح الخير/);
    expect(briefText({ at: '', numbers: zero, bestPost: null, topLeads: [], advisor: null, actions: [] })).toMatch(/الموافقات: 0/);
  });
});
