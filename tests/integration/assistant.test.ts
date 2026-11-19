import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { setAiProviderOverride } from '@/lib/ai';
import { chat, executeProposal, verifyProposal } from '@/lib/assistant/agent';
import { captured, captureQueues, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });

/** a scripted model: answers the planner with the given JSON steps in order */
class ScriptedAi extends FakeAiProvider {
  seen: string[] = [];
  constructor(private steps: unknown[]) { super(); }
  async generateJson(_s: string, user: string) { this.seen.push(user); return { json: this.steps.shift() ?? { tool: null, reply: 'تمام' }, usage: { inputTokens: 800, outputTokens: 80 }, model: 'fake-text' }; }
}
const owner = async () => { const { admin, accounts } = await seedBase(); return { accounts, user: { sub: admin.id, email: admin.email, perms: ['dashboard:view', 'ads:create'] as string[] } }; };

describe('assistant (tool-using chat with confirmed actions)', () => {
  it('without an AI key: answers status / approvals / accounts from rules, for free', async () => {
    const { user } = await owner();
    setAiProviderOverride(null); // seedBase settings: dry-run
    const a = await chat(user, [], 'كم تصميم ينتظر موافقتي؟');
    expect(a.source).toBe('rules'); expect(a.reply).toMatch(/في الطابور 0/);
    expect((await chat(user, [], 'شنو وضع النظام؟')).reply).toMatch(/صحة النظام \d+\/100/);
  });

  it('reads with tools, then answers from the real result (usage recorded)', async () => {
    const { user, accounts } = await owner();
    const ai = new ScriptedAi([{ tool: { name: 'list_accounts', args: {} }, reply: '' }, { tool: null, reply: 'عندك حسابان.' }]);
    setAiProviderOverride(ai);
    const r = await chat(user, [], 'كم حساب عندي؟');
    expect(r).toMatchObject({ source: 'ai', reply: 'عندك حسابان.', used: ['list_accounts'], proposal: null });
    expect(ai.seen[1]).toContain(accounts[0].name); // the tool result was given to the model
    expect(await prisma.aiUsage.count({ where: { inputTokens: 800 } })).toBe(2);
  });

  it('an action is only PROPOSED; «تأكيد» runs it; a changed or foreign proposal is refused', async () => {
    const { user, accounts } = await owner();
    setAiProviderOverride(new ScriptedAi([{ tool: { name: 'design_now', args: { account: accounts[0].name, idea: 'كوب بنقشة العيد الوطني', format: 'REEL_VIDEO' } }, reply: 'جهزت لك الطلب.' }]));
    const r = await chat(user, [], 'صمم ريل عن العيد الوطني');
    expect(r.proposal?.tool).toBe('design_now');
    expect(r.proposal?.summary).toMatch(/ريل/);
    expect(captured.generate).toHaveLength(0); // nothing happened yet
    await expect(executeProposal(user, { ...r.proposal!, args: { ...r.proposal!.args, accountId: accounts[1].id } })).rejects.toThrow(/غير صالح/);
    await expect(executeProposal({ ...user, sub: 'someone-else' }, r.proposal!)).rejects.toThrow(/غير صالح/);
    await expect(executeProposal({ ...user, perms: ['dashboard:view'] }, r.proposal!)).rejects.toThrow(/صلاحية/);
    await expect(executeProposal(user, { ...r.proposal!, exp: Date.now() - 1 })).rejects.toThrow(/صلاحية الاقتراح|غير صالح/);
    const done = await executeProposal(user, r.proposal!);
    expect(done.message).toMatch(/طابور الموافقات/);
    expect(captured.generate).toHaveLength(1);
    expect(captured.generate[0].data).toMatchObject({ accountId: accounts[0].id, format: 'REEL_VIDEO', direction: { idea: 'كوب بنقشة العيد الوطني' } });
  });

  it('a viewer cannot get an action proposal; unknown accounts are reported back to the model', async () => {
    const { accounts } = await owner();
    const viewer = { sub: 'v1', email: 'v@test.bh', perms: ['dashboard:view'] };
    const ai = new ScriptedAi([{ tool: { name: 'design_now', args: { account: accounts[0].name, idea: 'فكرة تجريبية طويلة' } } }, { tool: { name: 'account_plan', args: { account: 'nope' } } }, { tool: null, reply: 'ما عندك صلاحية.' }]);
    setAiProviderOverride(ai);
    const r = await chat(viewer, [], 'صمم');
    expect(r.proposal).toBeNull();
    expect(ai.seen[1]).toContain('no permission'); expect(ai.seen[2]).toContain('account not found');
    expect(() => verifyProposal(viewer, { tool: 'design_now', args: {}, summary: '', exp: Date.now() + 1000, sig: 'x' })).toThrow();
  });
});
