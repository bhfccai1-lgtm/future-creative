/**
 * APPROVAL TRIAGE — the order a busy owner should review in, so 65 designs take minutes, not an hour:
 *  - lane «ready»: passed every quality check and can be published as is → best quality first (one tap / bulk)
 *  - lane «attention»: needs a human look (review warnings, a missing asset) → oldest first, it is losing its moment
 *  - lane «blocked»: a trial (dry-run) or a hard quality failure → can only be rejected or regenerated
 * The quality number is the V10 rubric (/100) when the design was scored, otherwise the algorithm score — never invented.
 */
export type Lane = 'ready' | 'attention' | 'blocked';
export interface TriageInput {
  publishable: boolean; verdict: 'PASS' | 'NEEDS_REVIEW' | 'NEEDS_ASSET' | 'REJECTED'; dryRun: boolean;
  rubric?: number | null; algorithm?: number | null; createdAt: Date;
}
export interface Triage { lane: Lane; quality: number | null; qualitySource: 'rubric' | 'algorithm' | null; waitHours: number }

export function triage(i: TriageInput, now = new Date()): Triage {
  const lane: Lane = i.dryRun || i.verdict === 'REJECTED' ? 'blocked' : i.publishable ? 'ready' : 'attention';
  const quality = typeof i.rubric === 'number' ? i.rubric : typeof i.algorithm === 'number' ? i.algorithm : null;
  return { lane, quality, qualitySource: typeof i.rubric === 'number' ? 'rubric' : typeof i.algorithm === 'number' ? 'algorithm' : null, waitHours: Math.max(0, (now.getTime() - i.createdAt.getTime()) / 3600_000) };
}

/** ready: best quality first (ties → older first); attention: oldest first; blocked last */
export function sortQueue<T extends { triage: Triage; createdAt: Date }>(items: T[]): T[] {
  const rank: Record<Lane, number> = { ready: 0, attention: 1, blocked: 2 };
  return [...items].sort((a, b) => rank[a.triage.lane] - rank[b.triage.lane]
    || (a.triage.lane === 'ready' ? (b.triage.quality ?? -1) - (a.triage.quality ?? -1) : 0)
    || a.createdAt.getTime() - b.createdAt.getTime());
}

/** a short Arabic «waiting for» label: «منذ 40 د», «منذ 5 س», «منذ يومين» */
export function waitLabel(hours: number): string {
  if (hours < 1) return `منذ ${Math.max(1, Math.round(hours * 60))} د`;
  if (hours < 24) return `منذ ${Math.round(hours)} س`;
  const d = Math.round(hours / 24);
  return d === 1 ? 'منذ يوم' : d === 2 ? 'منذ يومين' : `منذ ${d} أيام`;
}
