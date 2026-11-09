import { prisma } from '../db';
import { BudgetExceededError } from '../errors';
import { notify } from '../audit';
import type { Settings } from '../settings';
import { startOfMonthInTz } from '../time';

export function estimateTextCost(s: Settings, inTok: number, outTok: number) {
  return (inTok / 1e6) * s.ai.pricing.textInputPer1M + (outTok / 1e6) * s.ai.pricing.textOutputPer1M;
}
export function estimateImageCost(s: Settings, quality: 'low' | 'medium' | 'high', n = 1) {
  const p = s.ai.pricing;
  return n * (quality === 'low' ? p.imageLow : quality === 'high' ? p.imageHigh : p.imageMedium);
}
/** Estimated cost of one full advertisement (brief + one scene image, ~2.5k in / 800 out tokens). */
export function estimateAdCost(s: Settings) {
  return estimateTextCost(s, 2500, 800) + estimateImageCost(s, s.ai.imageQuality);
}

export async function monthToDateSpend(now = new Date()): Promise<number> {
  const agg = await prisma.aiUsage.aggregate({ _sum: { costUsd: true }, where: { createdAt: { gte: startOfMonthInTz(now) } } });
  return Number(agg._sum.costUsd ?? 0);
}

/** Throws BudgetExceededError if spending `estimate` would cross the monthly cap. Emits a warning at the threshold. */
export async function assertBudget(s: Settings, estimate: number) {
  if (s.ai.dryRun) return; // dry-run costs nothing
  const spent = await monthToDateSpend();
  const cap = s.ai.monthlyBudgetUsd;
  if (cap <= 0 || spent + estimate > cap) {
    await notify('CRITICAL', 'BUDGET_EXCEEDED', 'تم بلوغ حد الإنفاق الشهري', `الإنفاق الحالي ${spent.toFixed(2)}$ من أصل ${cap.toFixed(2)}$. تم إيقاف التوليد بالذكاء الاصطناعي حتى بداية الشهر أو رفع الحد.`);
    throw new BudgetExceededError(`Monthly AI budget reached: spent ${spent.toFixed(4)} + est ${estimate.toFixed(4)} > cap ${cap}`);
  }
  if ((spent + estimate) / cap * 100 >= s.ai.alertThresholdPct) {
    await notify('WARNING', 'BUDGET_THRESHOLD', 'اقتراب من حد الإنفاق', `تم استهلاك ${(((spent + estimate) / cap) * 100).toFixed(0)}% من ميزانية الذكاء الاصطناعي الشهرية.`);
  }
}

export async function recordUsage(p: { jobId?: string; provider: string; model: string; kind: 'text' | 'image'; inputTokens?: number; outputTokens?: number; images?: number; costUsd: number }) {
  return prisma.aiUsage.create({ data: { jobId: p.jobId, provider: p.provider, model: p.model, kind: p.kind, inputTokens: p.inputTokens ?? 0, outputTokens: p.outputTokens ?? 0, images: p.images ?? 0, costUsd: p.costUsd.toFixed(6) } });
}
