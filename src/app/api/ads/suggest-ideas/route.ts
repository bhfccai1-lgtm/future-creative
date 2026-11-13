import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { getAiProvider } from '@/lib/ai';
import { assertBudget, estimateTextCost, recordUsage } from '@/lib/ai/cost';
import { recentIdeas } from '@/lib/dedup';
import { tasteProfile } from '@/lib/creative/taste';
import { getBusiness, ctaFor } from '@/lib/business';
import { selectProductForAccount } from '@/lib/creative/selector';
import { directionForPrompt } from '@/lib/creative/options';
import { DirectionSchema } from '@/lib/validation';
import { rateLimit } from '@/lib/security/rate-limit';
import { AppError } from '@/lib/errors';
import { AiProviderError } from '@/lib/ai/types';
import type { Lang } from '@/lib/render/fonts';

const Body = z.object({ accountId: z.string(), productId: z.string().optional(), language: z.enum(['ar', 'en', 'ml']).optional(), direction: DirectionSchema });

/** "اقترح أفكارًا مميزة": 3 distinct idea suggestions for the chosen product + direction. Costs one small text call (free in dry-run). */
export const POST = api('ads:create', async (req, { user }) => {
  const rl = await rateLimit(`ideas:${user.sub}`, 30, 3600);
  if (!rl.ok) throw new AppError('RATE_LIMITED', 'تم تجاوز عدد طلبات اقتراح الأفكار في الساعة.', 429);
  const b = Body.parse(await req.json());
  const s = await getSettings();
  const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: b.accountId } });
  const product = b.productId ? await prisma.product.findFirstOrThrow({ where: { id: b.productId, active: true } }) : await selectProductForAccount(account);
  if (!product) throw new AppError('NO_PRODUCT', 'لا توجد منتجات نشطة لهذا الحساب.', 422);
  const lang = (b.language ?? account.language) as Lang;
  const provider = await getAiProvider(s);
  if (!provider.isDryRun) await assertBudget(s, estimateTextCost(s, 2000, 600));
  const history = await recentIdeas(account.id, s.duplicateWindowDays);
  const taste = await tasteProfile();
  try {
    const r = await provider.suggestIdeas({
      language: lang, product: { ...product, recommendedMessages: product.recommendedMessages as Record<string, string[]> },
      accountName: account.name, businessCategory: account.businessCategory, creativeStyle: s.ai.creativeStyle,
      defaultCta: ctaFor(await getBusiness(), lang), avoidIdeas: [...history.ideas, ...taste.avoid.ideas], avoidHeadlines: [...history.headlines, ...taste.avoid.headlines], ownerFeedback: taste.feedback,
      attempt: Math.floor(Math.random() * 1000), direction: directionForPrompt(b.direction), occasionKey: b.direction?.occasion,
    }, s.ai.textModel, 3);
    if (!provider.isDryRun) await recordUsage({ provider: provider.name, model: r.model, kind: 'text', inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, costUsd: estimateTextCost(s, r.usage.inputTokens, r.usage.outputTokens) });
    return NextResponse.json({ product: { id: product.id, titleAr: product.titleAr }, ideas: r.ideas, dryRun: provider.isDryRun });
  } catch (e) {
    if (e instanceof AiProviderError) throw new AppError(`AI_${e.code}`, e.message, 502);
    throw e;
  }
});
