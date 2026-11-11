import { prisma } from '../db';
import { formatInTimeZone } from 'date-fns-tz';
import { mean, variance, welch, samplesNeeded, MIN_SAMPLE } from './stats';
import { OCCASIONS, CONTENT_TYPES, DESIGN_STYLES } from '../creative/options';

export interface Sample { score: number; dims: Record<string, string | null> }
export interface GroupStat { value: string; n: number; mean: number }
export type Confidence = 'CONFIRMED' | 'TREND' | 'INSUFFICIENT';
export interface Insight {
  dimension: string; dimensionAr: string; best: GroupStat; rest: GroupStat; liftPct: number; p: number | null;
  confidence: Confidence; note: string; experiment?: { a: string; b: string; perVariant: number | null };
}

export const DIMENSIONS: Record<string, string> = {
  format: 'صيغة المحتوى', hour: 'ساعة النشر (البحرين)', designStyle: 'أسلوب التصميم', contentType: 'نوع المحتوى',
  occasion: 'المناسبة', category: 'فئة المنتج', language: 'اللغة', template: 'القالب',
};
const LABELS: Record<string, Record<string, string>> = {
  format: { IMAGE_STORY: 'ستوري', IMAGE_FEED: 'منشور', IMAGE_SQUARE: 'مربع', REEL_VIDEO: 'ريلز', IMAGE_CAROUSEL: 'كاروسيل' },
  language: { ar: 'العربية', en: 'الإنجليزية', ml: 'المالايالامية' },
  occasion: Object.fromEntries(OCCASIONS.map((o) => [o.value, o.ar])),
  contentType: Object.fromEntries(CONTENT_TYPES.map((o) => [o.value, o.ar])),
  designStyle: Object.fromEntries(DESIGN_STYLES.map((o) => [o.value, o.ar])),
};
export const labelOf = (dim: string, v: string) => (dim === 'hour' ? `${v}:00` : LABELS[dim]?.[v] ?? v);

/**
 * Statistically cautious pattern finder: for every dimension, compare the best group against all other
 * posts with Welch's t-test. CONFIRMED needs p < 0.05 AND ≥ 5 posts on each side; otherwise the result is
 * at most a TREND with a suggested A/B experiment and the sample size needed to settle it.
 */
export function analyse(samples: Sample[]): { total: number; overall: number | null; insights: Insight[]; smallSample: boolean } {
  const insights: Insight[] = [];
  for (const [dim, dimAr] of Object.entries(DIMENSIONS)) {
    const groups = new Map<string, number[]>();
    for (const s of samples) { const v = s.dims[dim]; if (v) groups.set(v, [...(groups.get(v) ?? []), s.score]); }
    if (groups.size < 2) continue;
    const ranked = [...groups.entries()].filter(([, xs]) => xs.length >= 2).sort((a, b) => mean(b[1]) - mean(a[1]));
    if (!ranked.length) continue;
    const [bestV, bestXs] = ranked[0];
    const restXs = samples.filter((s) => s.dims[dim] && s.dims[dim] !== bestV).map((s) => s.score);
    if (!restXs.length) continue;
    const mb = mean(bestXs), mr = mean(restXs);
    const w = welch(bestXs, restXs);
    const enough = bestXs.length >= MIN_SAMPLE && restXs.length >= MIN_SAMPLE;
    const confidence: Confidence = enough && Number.isFinite(w.p) && w.p < 0.05 ? 'CONFIRMED' : bestXs.length >= 2 && restXs.length >= 2 ? 'TREND' : 'INSUFFICIENT';
    const sd = Math.sqrt(((variance(bestXs) || 0) + (variance(restXs) || 0)) / 2);
    const runnerUp = ranked[1]?.[0] ?? [...groups.keys()].find((k) => k !== bestV)!;
    const liftPct = mr > 0 ? ((mb - mr) / mr) * 100 : 0;
    insights.push({
      dimension: dim, dimensionAr: dimAr, liftPct, p: Number.isFinite(w.p) ? w.p : null, confidence,
      best: { value: bestV, n: bestXs.length, mean: mb }, rest: { value: 'الباقي', n: restXs.length, mean: mr },
      note: confidence === 'CONFIRMED'
        ? `«${labelOf(dim, bestV)}» أعلى تفاعلًا بنسبة ${liftPct.toFixed(0)}% (فرق دال إحصائيًا، p=${w.p.toFixed(3)}). نتيجة مبدئية — أعد التحقق دوريًا.`
        : `«${labelOf(dim, bestV)}» يبدو أفضل بنسبة ${liftPct.toFixed(0)}% لكن العينة (${bestXs.length} مقابل ${restXs.length}) لا تكفي للجزم.`,
      experiment: confidence === 'CONFIRMED' ? undefined : { a: bestV, b: runnerUp, perVariant: samplesNeeded(sd, mb - mr) },
    });
  }
  insights.sort((a, b) => (a.confidence === b.confidence ? b.liftPct - a.liftPct : a.confidence === 'CONFIRMED' ? -1 : b.confidence === 'CONFIRMED' ? 1 : 0));
  return { total: samples.length, overall: samples.length ? mean(samples.map((s) => s.score)) : null, insights, smallSample: samples.length < 20 };
}

/** Loads verified publications with engagement scores (optionally one account / time range) as samples. */
export async function loadSamples(where: { accountId?: string; since?: Date; until?: Date } = {}): Promise<Sample[]> {
  const rows = await prisma.publicationResult.findMany({
    where: { verifiedAt: { not: null, ...(where.since ? { gte: where.since } : {}), ...(where.until ? { lt: where.until } : {}) }, engagementScore: { not: null }, ...(where.accountId ? { job: { accountId: where.accountId } } : {}) },
    include: { job: { include: { account: { select: { timezone: true } }, advertisement: { select: { format: true, language: true, templateKey: true, options: true, product: { select: { category: { select: { nameAr: true } } } } } } } } },
  });
  return rows.map((r) => {
    const ad = r.job.advertisement;
    const o = (ad.options ?? {}) as { designStyle?: string | null; direction?: { contentType?: string; occasion?: string } | null };
    return {
      score: r.engagementScore!,
      dims: {
        format: ad.format, language: ad.language, template: ad.templateKey ?? null,
        hour: formatInTimeZone(r.job.scheduledFor, r.job.account.timezone, 'HH'),
        designStyle: o.designStyle ?? null, contentType: o.direction?.contentType ?? null, occasion: o.direction?.occasion ?? null,
        category: ad.product?.category?.nameAr ?? null,
      },
    };
  });
}
