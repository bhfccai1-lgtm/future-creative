import { prisma } from '../db';
import { audit, notify } from '../audit';
import { enq } from '../queue/queues';

/**
 * Restart recovery — run at worker start-up.
 *  - PUBLISHING jobs whose lock is stale: we cannot know whether the provider received them ⇒ UNKNOWN (reconcile, never resubmit blindly)
 *  - GENERATING ads interrupted mid-way ⇒ FAILED (generation is safe to redo; nothing was published)
 *  - QUEUED jobs ⇒ re-enqueued (BullMQ queue may have been flushed)
 */
export async function recoverAfterRestart(staleMs = 10 * 60_000) {
  const cutoff = new Date(Date.now() - staleMs);
  const stalePub = await prisma.publicationJob.findMany({ where: { state: 'PUBLISHING', OR: [{ lockedAt: null }, { lockedAt: { lt: cutoff } }] } });
  for (const j of stalePub) {
    await prisma.$transaction([
      prisma.publicationJob.update({ where: { id: j.id }, data: { state: 'UNKNOWN', lockedBy: null, nextCheckAt: new Date(), lastError: 'worker interrupted during submission' } }),
      prisma.advertisement.update({ where: { id: j.advertisementId }, data: { state: 'UNKNOWN' } }),
    ]);
  }
  const staleGen = await prisma.advertisement.updateMany({ where: { state: { in: ['GENERATING', 'GENERATED'] }, updatedAt: { lt: new Date(Date.now() - 30 * 60_000) } }, data: { state: 'FAILED', errorMessage: 'توقف التوليد بسبب إعادة تشغيل العامل' } });
  await prisma.publicationSchedule.updateMany({ where: { status: 'GENERATING', updatedAt: { lt: new Date(Date.now() - 30 * 60_000) } }, data: { status: 'FAILED', reason: 'interrupted' } });
  const queued = await prisma.publicationJob.findMany({ where: { state: 'QUEUED' } });
  for (const j of queued) await enq.publish(j.id);
  if (stalePub.length || staleGen.count) {
    await notify('WARNING', 'RESTART_RECOVERY', 'استرداد بعد إعادة التشغيل', `${stalePub.length} مهمة نشر بحاجة إلى مطابقة، ${staleGen.count} عملية توليد متوقفة.`);
  }
  await audit({ actorLabel: 'worker', action: 'worker.recovery', details: { unknown: stalePub.length, failedGen: staleGen.count, requeued: queued.length } });
  return { unknown: stalePub.map((j) => j.id), failedGenerations: staleGen.count, requeued: queued.length };
}

/** Data retention: prune old operational noise; keeps publication records and audit trail. */
export async function applyRetention(days = { notifications: 90, attemptsRaw: 180, rejectedMedia: 60 }) {
  const n = await prisma.notification.deleteMany({ where: { readAt: { not: null }, createdAt: { lt: new Date(Date.now() - days.notifications * 86400_000) } } });
  const a = await prisma.publicationAttempt.updateMany({ where: { startedAt: { lt: new Date(Date.now() - days.attemptsRaw * 86400_000) } }, data: { responseSummary: undefined } });
  const fp = await prisma.contentFingerprint.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 400 * 86400_000) } } });
  return { notifications: n.count, attempts: a.count, fingerprints: fp.count };
}
