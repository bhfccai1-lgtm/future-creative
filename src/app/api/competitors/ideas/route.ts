import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { getAiProvider } from '@/lib/ai';
import { assertBudget, estimateTextCost, recordUsage } from '@/lib/ai/cost';
import { recentIdeas } from '@/lib/dedup';
import { getBusiness, ctaFor } from '@/lib/business';
import { selectProductForAccount } from '@/lib/creative/selector';
import { competitorReport } from '@/lib/competitors/service';
import { AppError } from '@/lib/errors';
import type { Lang } from '@/lib/render/fonts';

const Body = z.object({ accountId: z.string(), brandId: z.string() });
/** 3 ORIGINAL ideas inspired by what performs for competitors (themes, formats, timing) — never copies their wording or designs. */
export const POST = api('ads:create', async (req) => {
  const b = Body.parse(await req.json());
  const rep = await competitorReport(b.brandId);
  if (!rep.analysis || !rep.analysis.posts) throw new AppError('NO_DATA', 'لا توجد بيانات منافسين بعد — حدّث من Metricool أو استورد CSV.', 412);
  const a = rep.analysis;
  const s = await getSettings();
  const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: b.accountId } });
  const product = await selectProductForAccount(account);
  if (!product) throw new AppError('NO_PRODUCT', 'لا توجد منتجات نشطة لهذا الحساب.', 422);
  const lang = account.language as Lang;
  const provider = await getAiProvider(s);
  if (!provider.isDryRun) await assertBudget(s, estimateTextCost(s, 2500, 600));
  const history = await recentIdeas(account.id, s.duplicateWindowDays);
  const brief = [
    'Market intelligence from local competitors (inspiration only — create ORIGINAL concepts; never copy their wording, designs or offers):',
    a.themes.length ? `Themes that over-perform: ${a.themes.slice(0, 6).map((t) => t.word).join(', ')}.` : '',
    a.gaps.length ? `Untapped by us: ${a.gaps.slice(0, 5).join(', ')}.` : '',
    a.formats.reelLift ? `Reels get ${a.formats.reelLift}x the interactions of feed posts.` : '',
    a.topPosts.length ? `Top competitor angles (summarised): ${a.topPosts.slice(0, 3).map((p) => p.caption.replace(/\s+/g, ' ').slice(0, 80)).join(' | ')}.` : '',
  ].filter(Boolean).join(' ').slice(0, 500);
  const r = await provider.suggestIdeas({
    language: lang, product: { ...product, recommendedMessages: product.recommendedMessages as Record<string, string[]> },
    accountName: account.name, businessCategory: account.businessCategory, creativeStyle: s.ai.creativeStyle,
    defaultCta: ctaFor(await getBusiness(), lang), avoidIdeas: history.ideas, avoidHeadlines: history.headlines,
    attempt: Math.floor(Math.random() * 1000), direction: { userIdea: brief },
  }, s.ai.textModel, 3);
  if (!provider.isDryRun) await recordUsage({ provider: provider.name, model: r.model, kind: 'text', inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, costUsd: estimateTextCost(s, r.usage.inputTokens, r.usage.outputTokens) });
  return NextResponse.json({ ideas: r.ideas, product: product.titleAr, basedOn: { themes: a.themes.slice(0, 6).map((t) => t.word), gaps: a.gaps.slice(0, 5) }, dryRun: provider.isDryRun });
});
