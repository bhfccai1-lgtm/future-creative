import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { setAiProviderOverride } from '@/lib/ai';
import { InstagramComments } from '@/lib/comments/instagram';
import { analyzePending, importComments, sendReply, setInstagramOverride, syncComments, hideComment } from '@/lib/comments/service';
import type { CommentAnalysisRequest } from '@/lib/ai/types';
import { captureQueues, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); setInstagramOverride(null); setAiProviderOverride(null); });
const owner = async () => { const u = await prisma.user.findFirstOrThrow({ where: { email: 'admin@test.bh' } }); return { sub: u.id, email: u.email }; };

/** Graph API double — records calls; nothing leaves the machine */
function fakeGraph(username: string) {
  const calls: { method: string; url: string; body?: string }[] = [];
  const fetchImpl = (async (u: URL, init?: RequestInit) => {
    const url = String(u); calls.push({ method: init?.method ?? 'GET', url, body: init?.body as string | undefined });
    const ok = (j: unknown) => new Response(JSON.stringify(j), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('/me/accounts')) return ok({ data: [{ name: 'p', instagram_business_account: { id: 'IG1', username } }, { name: 'x', instagram_business_account: { id: 'IG2', username: 'someone_else' } }] });
    if (url.includes('/IG1/media')) return ok({ data: [{ id: 'M1', permalink: 'https://instagram.com/p/M1', timestamp: new Date().toISOString(), comments_count: 3 }] });
    if (url.includes('/M1/comments')) return ok({ data: [
      { id: 'C1', text: 'بكم الكوب؟', username: 'sara.bh', timestamp: new Date().toISOString() },
      { id: 'C2', text: 'ماشاءالله روعة 😍', username: 'ali_99', timestamp: new Date().toISOString() },
      { id: 'C3', text: 'شكرًا لك', username, timestamp: new Date().toISOString() }, // our own reply → skipped
    ] });
    if (url.includes('/replies')) return ok({ id: 'R1' });
    if (/\/C\d+\?|\/C\d+$/.test(url.split('/v23.0')[1] ?? '')) return ok({ success: true });
    return ok({ data: [] });
  }) as unknown as typeof fetch;
  return { client: new InstagramComments({ token: 't', fetchImpl }), calls };
}

describe('comments: official sync, triage, safe drafts, human-sent replies', () => {
  it('syncs only our accounts, skips our own replies, analyses, and is idempotent', async () => {
    const { accounts } = await seedBase();
    await prisma.socialAccount.update({ where: { id: accounts[0].id }, data: { handle: '@bhfcc.mugs' } });
    const g = fakeGraph('bhfcc.mugs'); setInstagramOverride(g.client);
    const r = await syncComments();
    expect(r).toMatchObject({ added: 2, unmatched: ['someone_else'] });
    const rows = await prisma.socialComment.findMany({ orderBy: { externalId: 'asc' } });
    expect(rows.map((x) => [x.externalId, x.category, x.urgent])).toEqual([['C1', 'price', true], ['C2', 'praise', false]]);
    expect(rows[0].suggestedReply).toMatch(/@sara\.bh[\s\S]*33316319/);
    expect((await syncComments()).added).toBe(0); // no duplicates
    expect(g.calls.some((c) => c.method === 'POST')).toBe(false); // nothing posted by sync
  });

  it('a reply is sent only by a person, through the API, and unsafe text is refused', async () => {
    const { accounts } = await seedBase();
    await prisma.socialAccount.update({ where: { id: accounts[0].id }, data: { handle: 'bhfcc.mugs' } });
    const g = fakeGraph('bhfcc.mugs'); setInstagramOverride(g.client);
    await syncComments();
    const c = await prisma.socialComment.findFirstOrThrow({ where: { externalId: 'C1' } });
    await expect(sendReply(c.id, 'خصم 50% اليوم! كلمنا 39998877', await owner())).rejects.toThrow(/ممنوع|غير رسمي/);
    const r = await sendReply(c.id, c.suggestedReply!, await owner());
    expect(r).toMatchObject({ sent: true, status: 'REPLIED' });
    const post = g.calls.find((x) => x.method === 'POST')!;
    expect(post.url).toContain('/C1/replies');
    expect(decodeURIComponent(post.body!.replace(/\+/g, ' '))).toContain('33316319');
  });

  it('pasted comments work without a token; spam gets no draft and can be closed', async () => {
    const { accounts } = await seedBase();
    const r = await importComments(accounts[0].id, 'sara.bh: ابي اطلب 50 كوب للمدرسة\nbot_1: check my page http://spam.io\nالطلب تأخر وما وصل');
    expect(r).toMatchObject({ imported: 3, analysed: 3 });
    const rows = await prisma.socialComment.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows.map((x) => x.category)).toEqual(['order', 'spam', 'complaint']);
    expect(rows[1].suggestedReply).toBeNull();
    expect(rows[2].urgent).toBe(true);
    expect((await sendReply(rows[0].id, rows[0].suggestedReply!, await owner())).sent).toBe(false); // recorded, not posted
    await hideComment(rows[1].id, await owner());
    expect((await prisma.socialComment.findUniqueOrThrow({ where: { id: rows[1].id } })).status).toBe('IGNORED');
  });

  it('AI drafts are used when safe and replaced by the safe template when they break a rule', async () => {
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
    class Triage extends FakeAiProvider {
      async analyzeComments(req: CommentAnalysisRequest) {
        return { items: req.comments.map((c, i) => ({ id: c.id, category: 'price', sentiment: 'neutral', urgent: true, language: 'ar', summary: 'يسأل عن السعر', reply: i === 0 ? `هلا @${c.username} 🌷 راسلنا واتساب على 33316319` : 'السعر 3 دينار فقط!' })), usage: { inputTokens: 500, outputTokens: 200 }, model: 'fake-text' };
      }
    }
    setAiProviderOverride(new Triage());
    await importComments(accounts[0].id, 'sara.bh: بكم؟\nali_99: كم السعر');
    const rows = await prisma.socialComment.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows[0].suggestedReply).toContain('راسلنا واتساب');
    expect(rows[1].suggestedReply).not.toMatch(/دينار/);
    expect(rows[1].suggestedReply).toMatch(/@ali_99/);
    expect(rows.every((x) => x.summary === 'يسأل عن السعر')).toBe(true);
    expect((await analyzePending()).analysed).toBe(0);
  });
});
