import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { getIdeasProvider } from '@/lib/ai';
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
import { DryRunProvider } from '@/lib/ai/dry-run-provider';
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
  const history = await recentIdeas(account.id, s.duplicateWindowDays);
  const taste = await tasteProfile();
  const ideaReq = {
    language: lang, product: { ...product, recommendedMessages: product.recommendedMessages as Record<string, string[]> },
    accountName: account.name, businessCategory: account.businessCategory, creativeStyle: s.ai.creativeStyle,
    defaultCta: ctaFor(await getBusiness(), lang), avoidIdeas: [...history.ideas, ...taste.avoid.ideas], avoidHeadlines: [...history.headlines, ...taste.avoid.headlines], ownerFeedback: taste.feedback,
    attempt: Math.floor(Math.random() * 1000), direction: directionForPrompt(b.direction), occasionKey: b.direction?.occasion,
  };
  let provider: Awaited<ReturnType<typeof getIdeasProvider>> | null = null;
  let warning: string | null = null;
  try {
    provider = await getIdeasProvider(s);
    if (!provider.isDryRun) await assertBudget(s, estimateTextCost(s, 2000, 600));
    const r = await provider.suggestIdeas(ideaReq, s.ai.textModel, 3);
    if (!provider.isDryRun) await recordUsage({ provider: provider.name, model: r.model, kind: 'text', inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, costUsd: estimateTextCost(s, r.usage.inputTokens, r.usage.outputTokens) });
    if (r.ideas.length) return NextResponse.json({ product: { id: product.id, titleAr: product.titleAr }, ideas: r.ideas, dryRun: provider.isDryRun });
    warning = 'لم يُرجع الذكاء الاصطناعي أفكارًا هذه المرة';
  } catch (e) {
    // never leave the owner with nothing: explain why, and offer ready ideas from proven angles (no AI cost)
    warning = e instanceof AiProviderError ? `تعذّر الاتصال بالذكاء الاصطناعي (${e.message})`
      : e instanceof AppError ? e.message : 'تعذّر الاتصال بالذكاء الاصطناعي';
    console.error('[suggest-ideas]', e);
  }
  const fb = await new DryRunProvider().suggestIdeas(ideaReq, 'fallback', 3);
  return NextResponse.json({ product: { id: product.id, titleAr: product.titleAr }, ideas: fb.ideas, dryRun: provider?.isDryRun ?? false, fallback: true, warning: `${warning} — هذه أفكار جاهزة من زوايا مجرّبة، ويمكنك المحاولة مرة أخرى.` });
});
