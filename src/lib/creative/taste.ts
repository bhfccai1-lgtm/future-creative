import { prisma } from '../db';
import { getSettings } from '../settings';
import { CONCEPTS, DESIGN_STYLES } from './options';

/**
 * «يتعلم من ذوقك»: what the owner approved and rejected BY HAND (approval queue decisions, «طلب تعديل» notes)
 * shapes the next designs:
 *  - the owner's written reasons (+ standing guidance from AI settings) go into the creative brief;
 *  - rejected ideas/headlines are never proposed again (they used to drop out of the avoid list);
 *  - a visual concept or design style the owner keeps rejecting (≥ 3 decisions, ≤ 35 % approved) leaves the rotation.
 * Only human decisions count — automatic approvals say nothing about taste.
 */
export interface DimStat { value: string; label: string; approved: number; rejected: number; rate: number }
export interface Taste {
  feedback: string[];
  avoid: { ideas: string[]; headlines: string[] };
  blocked: { concept: string[]; designStyle: string[] };
  liked: { concept: string[]; designStyle: string[] };
  stats: { concept: DimStat[]; designStyle: DimStat[] };
  decisions: number;
}

const MIN_DECISIONS = 3, BLOCK_AT = 0.35, LIKE_AT = 0.75;

export async function tasteProfile(opts: { days?: number } = {}): Promise<Taste> {
  const since = new Date(Date.now() - (opts.days ?? 90) * 86400_000);
  const s = await getSettings();
  const decided = await prisma.approvalRequest.findMany({
    where: { status: { in: ['APPROVED', 'REJECTED'] }, decidedById: { not: null }, decidedAt: { gte: since } },
    orderBy: { decidedAt: 'desc' }, take: 400,
    select: { status: true, note: true, advertisement: { select: { headline: true, options: true, briefId: true } } },
  });
  const tally = (pick: (o: Record<string, unknown>) => string | null | undefined) => {
    const m = new Map<string, { approved: number; rejected: number }>();
    for (const d of decided) {
      const v = pick((d.advertisement.options ?? {}) as Record<string, unknown>);
      if (!v) continue;
      const t = m.get(v) ?? { approved: 0, rejected: 0 };
      if (d.status === 'APPROVED') t.approved++; else t.rejected++;
      m.set(v, t);
    }
    return m;
  };
  const conceptOf = (o: Record<string, unknown>) => ((o.direction ?? {}) as { art?: { concept?: string } }).art?.concept;
  const styleOf = (o: Record<string, unknown>) => (o.designStyle as string | null | undefined) ?? undefined;
  const toStats = (m: Map<string, { approved: number; rejected: number }>, label: (v: string) => string): DimStat[] =>
    [...m].map(([value, t]) => ({ value, label: label(value), ...t, rate: t.approved / Math.max(1, t.approved + t.rejected) })).sort((a, b) => b.approved + b.rejected - (a.approved + a.rejected));
  const concept = toStats(tally(conceptOf), (v) => CONCEPTS.find((c) => c.value === v)?.ar ?? v);
  const designStyle = toStats(tally(styleOf), (v) => DESIGN_STYLES.find((c) => c.value === v)?.ar ?? v);
  const enough = (x: DimStat) => x.approved + x.rejected >= MIN_DECISIONS;
  const rejected = decided.filter((d) => d.status === 'REJECTED');
  const briefIds = rejected.map((d) => d.advertisement.briefId).filter((x): x is string => !!x);
  const briefs = briefIds.length ? await prisma.creativeBrief.findMany({ where: { id: { in: briefIds } }, select: { idea: true, ideaKey: true } }) : [];
  const notes = [...new Set(rejected.map((d) => d.note?.trim()).filter((n): n is string => !!n && n.length >= 3))].slice(0, 8);
  return {
    feedback: [...(s.ai.ownerGuidance.trim() ? [s.ai.ownerGuidance.trim()] : []), ...notes],
    avoid: { ideas: briefs.flatMap((b) => [b.ideaKey, b.idea]), headlines: rejected.map((d) => d.advertisement.headline).filter((h): h is string => !!h) },
    blocked: { concept: concept.filter((x) => enough(x) && x.rate <= BLOCK_AT).map((x) => x.value), designStyle: designStyle.filter((x) => enough(x) && x.rate <= BLOCK_AT).map((x) => x.value) },
    liked: { concept: concept.filter((x) => enough(x) && x.rate >= LIKE_AT).map((x) => x.value), designStyle: designStyle.filter((x) => enough(x) && x.rate >= LIKE_AT).map((x) => x.value) },
    stats: { concept, designStyle },
    decisions: decided.length,
  };
}

/** Rotation pool without what the owner keeps rejecting — never empty (falls back to the full pool). */
export function withoutBlocked<T extends string>(pool: T[], blocked: string[]): T[] {
  const left = pool.filter((v) => !blocked.includes(v));
  return left.length ? left : pool;
}
