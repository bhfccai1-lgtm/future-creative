import type { AdState, PublicationJob } from '@prisma/client';
import { prisma } from '../db';
import { getSettings } from '../settings';
import { audit } from '../audit';
import { AppError, KillSwitchError } from '../errors';
import { assertTransition } from './state-machine';
import { enq } from '../queue/queues';
import type { QcReport } from '../qc';

/** Optimistic state change: only succeeds if the row is still in `from`. Returns false if someone else moved it. */
export async function moveAd(adId: string, from: AdState, to: AdState, data: Record<string, unknown> = {}) {
  assertTransition(from, to);
  const r = await prisma.advertisement.updateMany({ where: { id: adId, state: from }, data: { state: to, ...data } });
  return r.count === 1;
}

export async function approveAdvertisement(adId: string, user: { id: string; email: string }, note?: string) {
  const ad = await prisma.advertisement.findUniqueOrThrow({ where: { id: adId } });
  if (ad.state !== 'QUALITY_REVIEW') throw new AppError('BAD_STATE', `لا يمكن اعتماد إعلان في الحالة ${ad.state}.`, 409);
  if (!ad.qcPassed) throw new AppError('QC_FAILED', 'لا يمكن اعتماد إعلان لم يجتز فحص الجودة. أعد التوليد أو ارفضه.', 409);
  if (!(await moveAd(adId, 'QUALITY_REVIEW', 'APPROVED'))) throw new AppError('CONFLICT', 'تغيرت حالة الإعلان، حدّث الصفحة.', 409);
  await prisma.approvalRequest.updateMany({ where: { advertisementId: adId, status: 'PENDING' }, data: { status: 'APPROVED', decidedById: user.id, decidedAt: new Date(), note } });
  await audit({ actorId: user.id, actorLabel: user.email, action: 'ad.approve', targetType: 'advertisement', targetId: adId, details: { note: note ?? null } });
  // If the ad came from a scheduler slot that is still in the future, keep that slot.
  const sched = ad.scheduleId ? await prisma.publicationSchedule.findUnique({ where: { id: ad.scheduleId } }) : null;
  const s = await getSettings();
  if (sched && sched.slotAt.getTime() > Date.now() + s.scheduleLeadMinutes * 60_000 && s.autoPublishGlobal && !s.killSwitch) {
    return createPublicationJob(adId, sched.slotAt, user.email);
  }
  return null;
}

export async function rejectAdvertisement(adId: string, user: { id: string; email: string }, note?: string) {
  const ad = await prisma.advertisement.findUniqueOrThrow({ where: { id: adId } });
  if (!['QUALITY_REVIEW', 'APPROVED', 'QUEUED'].includes(ad.state)) throw new AppError('BAD_STATE', `لا يمكن رفض إعلان في الحالة ${ad.state}.`, 409);
  if (ad.state === 'QUEUED') {
    const busy = await prisma.publicationJob.count({ where: { advertisementId: adId, state: { in: ['PUBLISHING', 'SCHEDULED', 'UNKNOWN'] } } });
    if (busy) throw new AppError('BAD_STATE', 'الإعلان قيد الإرسال إلى المزود ولا يمكن رفضه الآن.', 409);
    await prisma.publicationJob.updateMany({ where: { advertisementId: adId, state: 'QUEUED' }, data: { state: 'REJECTED', lastError: 'rejected by admin' } });
  }
  if (!(await moveAd(adId, ad.state, 'REJECTED'))) throw new AppError('CONFLICT', 'تغيرت حالة الإعلان.', 409);
  await prisma.approvalRequest.updateMany({ where: { advertisementId: adId, status: 'PENDING' }, data: { status: 'REJECTED', decidedById: user.id, decidedAt: new Date(), note } });
  await audit({ actorId: user.id, actorLabel: user.email, action: 'ad.reject', targetType: 'advertisement', targetId: adId, details: { note: note ?? null } });
}

/** Autonomous path: only for QC-publishable ads; records an audit entry attributed to the scheduler. */
export async function autoApproveAndQueue(adId: string) {
  const ad = await prisma.advertisement.findUniqueOrThrow({ where: { id: adId }, include: { schedule: true } });
  const qc = ad.qcReport as unknown as QcReport | null;
  if (!qc?.publishable || ad.dryRun) return null;
  if (!(await moveAd(adId, 'QUALITY_REVIEW', 'APPROVED'))) return null;
  await audit({ actorLabel: 'scheduler', action: 'ad.auto_approve', targetType: 'advertisement', targetId: adId });
  const when = ad.schedule?.slotAt ?? new Date();
  return createPublicationJob(adId, when, 'scheduler');
}

/**
 * Creates (idempotently) the publication job for an APPROVED ad and enqueues it.
 * The unique idempotency key guarantees one publication request per ad/account/provider.
 */
export async function createPublicationJob(adId: string, scheduledFor: Date, actor: string): Promise<PublicationJob> {
  const s = await getSettings();
  if (s.killSwitch) throw new KillSwitchError();
  const ad = await prisma.advertisement.findUniqueOrThrow({ where: { id: adId }, include: { account: { include: { connection: true } } } });
  const qc = ad.qcReport as unknown as QcReport | null;
  if (ad.dryRun) throw new AppError('DRY_RUN', 'هذا الإعلان معاينة تجريبية (Dry-run) ولا يمكن نشره. فعّل OpenAI وأعد التوليد.', 409);
  if (!qc?.publishable) throw new AppError('QC_FAILED', 'الإعلان غير صالح للنشر وفق فحص الجودة.', 409);
  const conn = ad.account.connection;
  if (!conn || conn.status !== 'CONNECTED' || !conn.canPublish || !conn.providerBrandId) {
    throw new AppError('NOT_CONNECTED', 'الحساب غير مرتبط بمزود نشر مؤكد أو لا يملك صلاحية النشر.', 412);
  }
  const lead = s.scheduleLeadMinutes * 60_000;
  const when = new Date(Math.max(scheduledFor.getTime(), Date.now() + lead)); // never in the past
  const idempotencyKey = `pub:${ad.id}:${ad.accountId}:${conn.provider}`;

  const existing = await prisma.publicationJob.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;

  let job: PublicationJob;
  try {
    job = await prisma.$transaction(async (tx) => {
      const moved = await tx.advertisement.updateMany({ where: { id: ad.id, state: 'APPROVED' }, data: { state: 'QUEUED' } });
      if (moved.count !== 1) throw new AppError('BAD_STATE', 'يجب أن يكون الإعلان معتمدًا قبل جدولته.', 409);
      return tx.publicationJob.create({ data: { idempotencyKey, advertisementId: ad.id, accountId: ad.accountId, provider: conn.provider, state: 'QUEUED', scheduledFor: when } });
    });
  } catch (e) {
    const again = await prisma.publicationJob.findUnique({ where: { idempotencyKey } });
    if (again) return again; // lost a race to another request — idempotent result
    throw e;
  }
  await audit({ actorLabel: actor, action: 'publication.queue', targetType: 'publication_job', targetId: job.id, details: { adId, scheduledFor: when.toISOString() } });
  await enq.publish(job.id);
  return job;
}

/** "نشر الآن": approve (if pending and QC-passed) and queue for the earliest safe time. */
export async function publishNow(adId: string, user: { id: string; email: string }) {
  const s = await getSettings();
  if (s.killSwitch) throw new KillSwitchError();
  const ad = await prisma.advertisement.findUniqueOrThrow({ where: { id: adId } });
  if (ad.state === 'QUALITY_REVIEW') await approveAdvertisement(adId, user, 'publish-now');
  const fresh = await prisma.advertisement.findUniqueOrThrow({ where: { id: adId } });
  if (fresh.state === 'QUEUED') return prisma.publicationJob.findFirstOrThrow({ where: { advertisementId: adId } });
  if (fresh.state !== 'APPROVED') throw new AppError('BAD_STATE', `لا يمكن نشر إعلان في الحالة ${fresh.state}.`, 409);
  await audit({ actorId: user.id, actorLabel: user.email, action: 'ad.publish_now', targetType: 'advertisement', targetId: adId });
  return createPublicationJob(adId, new Date(), user.email);
}
