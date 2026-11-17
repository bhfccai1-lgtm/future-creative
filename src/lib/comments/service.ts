import { prisma } from '../db';
import { getSettings, getSecret } from '../settings';
import { getAiProvider } from '../ai';
import { assertBudget, estimateTextCost, recordUsage } from '../ai/cost';
import { getBusiness, contactLines, ctaFor } from '../business';
import { audit } from '../audit';
import { AppError } from '../errors';
import { log } from '../ops/log';
import { InstagramComments } from './instagram';
import { classifyComment, parsePasted, replyIssues, templateReply, type CommentCategory } from './classify';

const CATS: CommentCategory[] = ['order', 'price', 'info', 'praise', 'complaint', 'spam', 'other'];
const norm = (h?: string | null) => (h ?? '').replace(/^@/, '').trim().toLowerCase();

let igOverride: InstagramComments | null = null;
/** test hook */
export function setInstagramOverride(c: InstagramComments | null) { igOverride = c; }
async function ig() {
  if (igOverride) return igOverride;
  const token = await getSecret('META_COMMENTS_TOKEN');
  if (!token) return null;
  const s = await getSettings();
  return new InstagramComments({ token, version: s.whatsapp.catalog.graphVersion });
}

async function replyCtx() {
  const b = await getBusiness();
  const phones = contactLines(b, 'ar').map((c) => ({ label: c.label, phone: c.phone }));
  return { business: b.nameAr, phones, cta: ctaFor(b, 'ar'), allowed: phones.map((p) => p.phone.replace(/\D/g, '')) };
}

/** Pull comments on our posts through the official API; only new comments are added (decisions are never overwritten). */
export async function syncComments(opts: { days?: number } = {}) {
  const client = await ig();
  if (!client) return { skipped: 'NO_TOKEN' as const, added: 0 };
  const igAccounts = await client.accounts();
  const ours = await prisma.socialAccount.findMany({ where: { handle: { not: null } }, select: { id: true, handle: true } });
  let added = 0; const unmatched: string[] = []; const errors: string[] = [];
  for (const a of igAccounts) {
    const acc = ours.find((o) => norm(o.handle) === norm(a.username));
    if (!acc) { unmatched.push(a.username); continue; }
    try {
      const rows = (await client.recentComments(a.igId, opts.days ?? 14)).filter((c) => norm(c.username) !== norm(a.username)); // skip our own replies
      for (const c of rows) {
        if (await prisma.socialComment.findUnique({ where: { externalId: c.id }, select: { id: true } })) continue; // known: never overwrite a decision
        await prisma.socialComment.create({ data: {
          accountId: acc.id, externalId: c.id, mediaId: c.mediaId, permalink: c.permalink ?? null, username: c.username ?? null,
          text: c.text.slice(0, 2000), postedAt: c.timestamp ? new Date(c.timestamp) : null, source: 'graph',
        } }).then(() => added++).catch(() => { /* created concurrently */ });
      }
    } catch (e) { errors.push(`${a.username}: ${(e as Error).message.slice(0, 140)}`); }
  }
  const analysed = added ? await analyzePending() : { analysed: 0 };
  return { added, unmatched, errors, ...analysed };
}

/** Comments pasted by the owner (works without any Meta token). */
export async function importComments(accountId: string, blob: string, actor?: string) {
  await prisma.socialAccount.findUniqueOrThrow({ where: { id: accountId }, select: { id: true } });
  const rows = parsePasted(blob);
  if (!rows.length) throw new AppError('EMPTY', 'لم أجد تعليقات في النص — ضع كل تعليق في سطر.', 422);
  await prisma.socialComment.createMany({ data: rows.map((r) => ({ accountId, username: r.username, text: r.text, source: 'manual' })) });
  await audit({ actorLabel: actor ?? 'comments', action: 'comments.import', targetType: 'account', targetId: accountId, details: { count: rows.length } });
  return { imported: rows.length, ...(await analyzePending()) };
}

/** Triage + reply drafts for comments without analysis: AI in batches (validated), safe templates otherwise. */
export async function analyzePending(limit = 80) {
  const pending = await prisma.socialComment.findMany({ where: { category: null }, orderBy: { createdAt: 'asc' }, take: limit, include: { account: { select: { name: true } } } });
  if (!pending.length) return { analysed: 0, ai: 0 };
  const s = await getSettings();
  const ctx = await replyCtx();
  const provider = await getAiProvider(s).catch(() => null);
  const ai = new Map<string, { category: CommentCategory; sentiment: string; urgent: boolean; language: string; summary: string; reply: string }>();
  if (provider && !provider.isDryRun && provider.analyzeComments) {
    for (let i = 0; i < pending.length; i += 20) {
      const batch = pending.slice(i, i + 20);
      try {
        await assertBudget(s, estimateTextCost(s, 1500 + batch.length * 120, batch.length * 120));
        const r = await provider.analyzeComments({ business: ctx.business, phones: ctx.phones, cta: ctx.cta, comments: batch.map((c) => ({ id: c.id, text: c.text, username: c.username, account: c.account.name })) }, s.ai.textModel);
        await recordUsage({ provider: provider.name, model: r.model, kind: 'text', inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, costUsd: estimateTextCost(s, r.usage.inputTokens, r.usage.outputTokens) });
        for (const it of r.items) if (batch.some((b) => b.id === it.id) && CATS.includes(it.category as CommentCategory)) ai.set(it.id, { ...it, category: it.category as CommentCategory });
      } catch (e) { log.warn('comments.ai_failed', { error: (e as Error).message }); }
    }
  }
  for (const c of pending) {
    const rule = classifyComment(c.text);
    const a = ai.get(c.id);
    const category = a?.category ?? rule.category;
    const language = a?.language ?? rule.language;
    let reply = a?.reply?.trim() ?? '';
    // an AI draft that breaks a rule (price, promise, unofficial number, link…) is replaced by the safe template
    if (category !== 'spam' && (!reply || replyIssues(reply, ctx.allowed).length)) reply = templateReply(category, language, { username: c.username, phones: ctx.phones, cta: ctx.cta });
    await prisma.socialComment.update({ where: { id: c.id }, data: {
      category, sentiment: a?.sentiment ?? rule.sentiment, urgent: a ? !!a.urgent || rule.urgent : rule.urgent, language,
      summary: a?.summary?.slice(0, 120) ?? null, suggestedReply: category === 'spam' ? null : reply,
    } });
  }
  return { analysed: pending.length, ai: ai.size };
}

/** A person sends the reply: through the official API for synced comments, or recorded as answered for pasted ones. */
export async function sendReply(id: string, text: string, user: { sub: string; email: string }) {
  const c = await prisma.socialComment.findUniqueOrThrow({ where: { id } });
  const ctx = await replyCtx();
  const issues = replyIssues(text, ctx.allowed);
  if (issues.length) throw new AppError('UNSAFE_REPLY', `لا يمكن إرسال الرد: ${issues.join('، ')}`, 422);
  let sent = false;
  if (c.source === 'graph' && c.externalId) {
    const client = await ig();
    if (!client) throw new AppError('NO_TOKEN', 'رمز Meta للتعليقات غير محفوظ — احفظه أولًا أو انسخ الرد يدويًا.', 412);
    await client.reply(c.externalId, text.trim());
    sent = true;
  }
  const r = await prisma.socialComment.update({ where: { id }, data: { status: 'REPLIED', repliedText: text.trim(), repliedAt: new Date(), repliedBy: user.email } });
  await audit({ actorId: user.sub, actorLabel: user.email, action: sent ? 'comments.reply.sent' : 'comments.reply.manual', targetType: 'comment', targetId: id, details: { category: c.category } });
  return { ...r, sent };
}

export async function hideComment(id: string, user: { sub: string; email: string }) {
  const c = await prisma.socialComment.findUniqueOrThrow({ where: { id } });
  if (c.source === 'graph' && c.externalId) { const client = await ig(); if (client) await client.hide(c.externalId); }
  await prisma.socialComment.update({ where: { id }, data: { status: 'IGNORED' } });
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'comments.hide', targetType: 'comment', targetId: id });
}

export async function commentStats() {
  const since = new Date(Date.now() - 30 * 86400_000);
  const [byCat, open, urgent, replied] = await Promise.all([
    prisma.socialComment.groupBy({ by: ['category'], _count: true, where: { createdAt: { gte: since } } }),
    prisma.socialComment.count({ where: { status: 'NEW' } }),
    prisma.socialComment.count({ where: { status: 'NEW', urgent: true } }),
    prisma.socialComment.findMany({ where: { status: 'REPLIED', repliedAt: { gte: since }, postedAt: { not: null } }, select: { postedAt: true, repliedAt: true }, take: 500 }),
  ]);
  const mins = replied.map((r) => (r.repliedAt!.getTime() - r.postedAt!.getTime()) / 60000).filter((m) => m >= 0).sort((a, b) => a - b);
  return { byCat: Object.fromEntries(byCat.map((b) => [b.category ?? 'pending', b._count])), open, urgent, medianReplyMin: mins.length ? Math.round(mins[Math.floor(mins.length / 2)]) : null, total: byCat.reduce((a, b) => a + b._count, 0) };
}
