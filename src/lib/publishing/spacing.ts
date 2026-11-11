import type { Prisma } from '@prisma/client';

/** Jobs that occupy a slot on the account (a failed or cancelled job frees its slot). Satellite (GBP) jobs share the primary's time. */
const ACTIVE = ['QUEUED', 'PUBLISHING', 'SCHEDULED', 'UNKNOWN', 'PUBLISHED'] as const;

/**
 * Returns the first time ≥ `when` that is at least `gapMin` minutes away from every other active post on the account.
 * Must run inside a transaction holding the account's advisory lock (see lockAccount) so two jobs can't pick the same slot.
 */
export async function spacedTime(tx: Prisma.TransactionClient, accountId: string, when: Date, gapMin: number, excludeJobId?: string): Promise<Date> {
  if (gapMin <= 0) return when;
  const gap = gapMin * 60_000;
  const others = await tx.publicationJob.findMany({
    where: { accountId, primary: true, state: { in: [...ACTIVE] }, ...(excludeJobId ? { id: { not: excludeJobId } } : {}), scheduledFor: { gte: new Date(when.getTime() - gap), lte: new Date(when.getTime() + 48 * 3600_000) } },
    select: { scheduledFor: true }, orderBy: { scheduledFor: 'asc' },
  });
  let t = when.getTime();
  for (const o of others) {
    const s = o.scheduledFor.getTime();
    if (Math.abs(s - t) < gap) t = s + gap; // too close → move just after it (list is sorted, so later conflicts are checked next)
  }
  return new Date(t);
}

/** Per-account transaction lock (released at commit/rollback). */
export async function lockAccount(tx: Prisma.TransactionClient, accountId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'pubgap:' + accountId}))`;
}
