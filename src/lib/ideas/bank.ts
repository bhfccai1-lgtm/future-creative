import type { Idea, SocialAccount } from '@prisma/client';
import { prisma } from '../db';
import { getSettings } from '../settings';
import { getAiProvider } from '../ai';
import { assertBudget, estimateTextCost, recordUsage } from '../ai/cost';
import { recentIdeas } from '../dedup';
import { getBusiness, ctaFor } from '../business';
import { selectProductForAccount } from '../creative/selector';
import { IDEA_ANGLES, OCCASIONS, type Direction } from '../creative/options';
import { analyse, labelOf, loadSamples } from '../analytics/insights';
import { marketOf, upcomingOccasions } from '../creative/planner';
import { pickLeastRecent } from '../pipeline/generate';
import { tasteProfile } from '../creative/taste';
import { audit } from '../audit';
import type { Lang } from '../render/fonts';

/**
 * «بنك الأفكار»: rated ideas per account, built from proven ad angles, what already worked on the account
 * (real metrics), upcoming occasions and the 30-day avoid list. Approved ideas are picked up by automatic
 * generation (scheduler / campaigns without their own idea), each used once.
 */
export const IDEA_FORMATS = ['REEL_VIDEO', 'IMAGE_CAROUSEL', 'IMAGE_FEED', 'IMAGE_STORY'] as const;

/** What worked (confirmed/trending patterns from real metrics) + occasions in the next 3 weeks. */
export async function ideaContext(account: Pick<SocialAccount, 'id' | 'name' | 'handle' | 'businessCategory' | 'language'>, now = new Date()) {
  const an = analyse(await loadSamples({ accountId: account.id, since: new Date(now.getTime() - 90 * 86400_000) }));
  const winners = an.insights.filter((i) => i.confidence !== 'INSUFFICIENT' && ['contentType', 'format', 'occasion', 'category'].includes(i.dimension))
    .slice(0, 4).map((i) => `${i.dimensionAr}: ${labelOf(i.dimension, i.best.value)} (+${Math.round(i.liftPct)}%)`);
  const market = marketOf(account);
  const upcoming = upcomingOccasions(now, 21)
    .filter((w) => market === 'KSA' ? !/bahrain|البحرين/i.test(w.key) : true)
    .slice(0, 3).map((w) => `${OCCASIONS.find((o) => o.value === w.key)?.en ?? w.key} in ${w.daysToPeak} days`);
  return { winners, upcoming, nextOccasion: upcomingOccasions(now, 21)[0]?.key ?? null };
}

/** Generates `count` rated ideas for one account (one product, angles rotated least-recently-used). */
export async function generateIdeas(accountId: string, opts: { count?: number; productId?: string; source?: string; actor?: string } = {}) {
  const s = await getSettings();
  const count = Math.min(6, Math.max(1, opts.count ?? s.ideas.perAccount));
  const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: accountId } });
  const product = opts.productId ? await prisma.product.findFirstOrThrow({ where: { id: opts.productId, active: true } }) : await selectProductForAccount(account);
  if (!product) return [];
  const lang = account.language as Lang;
  const provider = await getAiProvider(s);
  if (!provider.isDryRun) await assertBudget(s, estimateTextCost(s, 2500, 900));
  const ctx = await ideaContext(account);
  const prevAngles = (await prisma.idea.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' }, take: 24, select: { angle: true } })).map((x) => x.angle);
  const angles: string[] = [];
  for (let i = 0; i < count; i++) angles.push(pickLeastRecent(IDEA_ANGLES.map((a) => a.value as string).filter((a) => !angles.includes(a)), [...angles, ...prevAngles].reverse()));
  const history = await recentIdeas(accountId, s.duplicateWindowDays);
  const taste = await tasteProfile();
  const banked = await prisma.idea.findMany({ where: { accountId, status: { in: ['NEW', 'APPROVED'] } }, select: { title: true, idea: true }, take: 60 });
  const r = await provider.suggestIdeas({
    language: lang, product: { ...product, recommendedMessages: product.recommendedMessages as Record<string, string[]> },
    accountName: account.name, businessCategory: account.businessCategory, creativeStyle: s.ai.creativeStyle,
    defaultCta: ctaFor(await getBusiness(), lang), avoidIdeas: [...history.ideas, ...banked.map((b) => b.idea), ...taste.avoid.ideas], avoidHeadlines: [...history.headlines, ...banked.map((b) => b.title), ...taste.avoid.headlines], ownerFeedback: taste.feedback,
    attempt: Math.floor(Math.random() * 1000), ideaContext: { winners: ctx.winners, upcoming: ctx.upcoming, angles: angles.map((a) => `${a}: ${IDEA_ANGLES.find((x) => x.value === a)!.prompt}`) },
  }, s.ai.textModel, count);
  if (!provider.isDryRun) await recordUsage({ provider: provider.name, model: r.model, kind: 'text', inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, costUsd: estimateTextCost(s, r.usage.inputTokens, r.usage.outputTokens) });
  const autoApprove = s.ideas.autoApproveMinScore > 0;
  const created: Idea[] = [];
  for (const [i, x] of r.ideas.entries()) {
    const angle = IDEA_ANGLES.some((a) => a.value === x.angle?.split(':')[0]) ? x.angle!.split(':')[0] : angles[i] ?? null;
    const score = typeof x.score === 'number' && Number.isFinite(x.score) ? Math.min(10, Math.max(1, x.score)) : null;
    created.push(await prisma.idea.create({ data: {
      accountId, productId: product.id, language: lang, title: x.title.slice(0, 120), idea: x.idea.slice(0, 600), hook: x.hook?.slice(0, 160) || null, angle,
      format: IDEA_FORMATS.includes(x.format as never) ? x.format! : null, occasion: angle === 'seasonal_countdown' ? ctx.nextOccasion : null,
      score, why: x.why?.slice(0, 300) || null, source: opts.source ?? 'weekly',
      status: autoApprove && score != null && score >= s.ideas.autoApproveMinScore && !provider.isDryRun ? 'APPROVED' : 'NEW',
    } }));
  }
  await audit({ actorLabel: opts.actor ?? 'ideas', action: 'ideas.generate', targetType: 'account', targetId: accountId, details: { count: created.length, product: product.slug } });
  return created;
}

/** Weekly: refill the bank for every active account that has fewer than `perAccount` open ideas. Skipped in dry-run (no fake ideas in the bank). */
export async function weeklyIdeas() {
  const s = await getSettings();
  if (!s.ideas.weekly) return { skipped: 'disabled' };
  if ((await getAiProvider(s)).isDryRun) return { skipped: 'dry_run' };
  const accounts = await prisma.socialAccount.findMany({ where: { paused: false, autoPublishEnabled: true }, select: { id: true } });
  let made = 0;
  for (const a of accounts) {
    const open = await prisma.idea.count({ where: { accountId: a.id, status: { in: ['NEW', 'APPROVED'] } } });
    if (open >= s.ideas.perAccount * 2) continue;
    try { made += (await generateIdeas(a.id, { source: 'weekly' })).length; } catch { /* budget / provider error: next week */ }
  }
  return { made };
}

/** Takes the best approved idea for an account (highest score, then oldest) and turns it into a generation direction. */
export async function takeApprovedIdea(accountId: string): Promise<{ idea: Idea; productId: string; format: string | null; direction: Direction } | null> {
  const s = await getSettings();
  if (!s.ideas.useBank) return null;
  const idea = await prisma.idea.findFirst({ where: { accountId, status: 'APPROVED', product: { active: true } }, orderBy: [{ score: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }] });
  if (!idea) return null;
  const claimed = await prisma.idea.updateMany({ where: { id: idea.id, status: 'APPROVED' }, data: { status: 'USED' } });
  if (!claimed.count) return null; // taken by a concurrent job
  const direction: Direction = { idea: [idea.title, idea.idea, idea.hook ? `Hook: ${idea.hook}` : ''].filter(Boolean).join(' — ').slice(0, 500), ...(idea.occasion && OCCASIONS.some((o) => o.value === idea.occasion) ? { occasion: idea.occasion } : {}) };
  return { idea, productId: idea.productId, format: idea.format, direction };
}

export const angleAr = (v: string | null) => IDEA_ANGLES.find((a) => a.value === v)?.ar ?? '—';

/** Scheduler generation: uses the best approved idea when there is one (product, best format for growth-mix accounts, idea text). */
export async function generateFromBank<T extends { accountId: string; productId?: string; format?: string; direction?: Direction }, R extends { advertisement: { id: string } }>(data: T, run: (d: T) => Promise<R>): Promise<R> {
  if (data.productId || data.direction?.idea) return run(data);
  const take = await takeApprovedIdea(data.accountId);
  if (!take) return run(data);
  const acc = await prisma.socialAccount.findUnique({ where: { id: data.accountId }, select: { formatStrategy: true } });
  try {
    const r = await run({ ...data, productId: take.productId, ...(take.format && acc?.formatStrategy === 'GROWTH_MIX' ? { format: take.format } : {}), direction: { ...(data.direction ?? {}), ...take.direction } });
    await prisma.idea.update({ where: { id: take.idea.id }, data: { usedAdId: r.advertisement.id } });
    return r;
  } catch (e) {
    await prisma.idea.update({ where: { id: take.idea.id }, data: { status: 'APPROVED' } }); // not consumed by a failed attempt
    throw e;
  }
}
