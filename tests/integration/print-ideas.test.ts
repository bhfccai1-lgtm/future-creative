import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { setAiProviderOverride } from '@/lib/ai';
import { createPrint, generateHero, suggestPrintIdeas } from '@/lib/print/service';
import { parseIdeas } from '@/lib/print/ideas';
import { captureQueues, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });
const card = { productId: 'business_card', activity: 'أعراس ومناسبات', business: 'Lilac Events', sizeId: 'bc90x50', texts: { headline: 'أعراس ومناسبات' } };

class IdeasAi extends FakeAiProvider {
  calls = 0; lastUser = '';
  async generateJson(_system: string, user: string) {
    this.calls++; this.lastUser = user;
    return { json: { ideas: Array.from({ length: 5 }, (_, i) => ({ title: `فكرة ${i + 1}`, idea: `باقة ورد أبيض على مخمل كحلي مع ضوء شموع خافت، زاوية ${i + 1}`, why: 'فخامة الأعراس' })) }, usage: { inputTokens: 600, outputTokens: 400 }, model: 'fake-text' };
  }
}

describe('print studio — design ideas', () => {
  it('without an AI key: 5 free template ideas for the product, mentioning the activity', async () => {
    const { admin } = await seedBase();
    const user = { sub: admin.id, email: admin.email, perms: ['ads:create'] };
    const p = await createPrint(card, user);
    const r = await suggestPrintIdeas(p.id, user);
    expect(r.source).toBe('templates');
    expect(r.ideas).toHaveLength(5);
    expect(r.ideas.some((x) => x.idea.includes('أعراس ومناسبات'))).toBe(true);
  });
  it('with a key: AI ideas fitted to product + activity (one text call, usage recorded)', async () => {
    const { admin } = await seedBase();
    const user = { sub: admin.id, email: admin.email, perms: ['ads:create'] };
    const ai = new IdeasAi(); setAiProviderOverride(ai);
    const p = await createPrint(card, user);
    const r = await suggestPrintIdeas(p.id, user);
    expect(r.source).toBe('ai'); expect(r.ideas).toHaveLength(5); expect(ai.calls).toBe(1);
    expect(JSON.parse(ai.lastUser)).toMatchObject({ activity: 'أعراس ومناسبات', family: 'card' });
    expect(await prisma.aiUsage.count({ where: { inputTokens: 600 } })).toBe(1);
  });
  it('the owner\'s idea drives the picture prompt, is stored in the brief and never asks for text', async () => {
    const { admin } = await seedBase();
    const user = { sub: admin.id, email: admin.email, perms: ['ads:create'] };
    const ai = new FakeAiProvider(); setAiProviderOverride(ai);
    const p = await createPrint(card, user);
    const idea = 'باقة ورد أبيض على مخمل كحلي مع ضوء شموع خافت';
    const g = await generateHero(p.id, user, { idea });
    expect((g.brief as { artIdea?: string }).artIdea).toBe(idea);
    expect(ai.lastScenePrompt).toContain(idea);
    expect(ai.lastScenePrompt).toMatch(/CLIENT'S OWN DESIGN IDEA/);
    expect(ai.lastScenePrompt).toMatch(/ABSOLUTELY NO text/);
  });
  it('rejects malformed model answers', () => {
    expect(parseIdeas({ ideas: [{ title: '', idea: 'x' }, { title: 'ok', idea: 'قصير' }] })).toEqual([]);
    expect(parseIdeas('nope')).toEqual([]);
  });
});
