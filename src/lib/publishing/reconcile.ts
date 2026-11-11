import { prisma } from '../db';
import { audit, notify } from '../audit';
import { getAdapter } from './registry';
import { buildPublishRequest } from './publisher';
import { enq } from '../queue/queues';
import { getSettings } from '../settings';
import { AppError } from '../errors';

export const MAX_PUBLISH_ATTEMPTS = 3;
export const ABSENT_MSG = 'absent at provider — awaiting operator decision';
const ABSENCE_GRACE_MS = 5 * 60_000;

/**
 * Reconciles one job with the provider:
 *  UNKNOWN   → look for the post; found ⇒ SCHEDULED; proven absent after grace ⇒ re-queue (bounded); lookup error ⇒ stay UNKNOWN
 *  SCHEDULED → read provider status; PUBLISHED only on explicit provider confirmation
 */
export async function reconcileJob(jobId: string): Promise<string> {
  const job = await prisma.publicationJob.findUniqueOrThrow({ where: { id: jobId }, include: { result: true, attempts: { orderBy: { attemptNo: 'desc' }, take: 1 }, account: { include: { connection: true } } } });
  const adapter = await getAdapter(job.provider);

  if (job.state === 'UNKNOWN') {
    const req = await buildPublishRequest(job.id);
    let found;
    try { found = await adapter.findExisting(req); }
    catch (e) { await prisma.publicationJob.update({ where: { id: job.id }, data: { nextCheckAt: new Date(Date.now() + 5 * 60_000), lastError: `reconcile lookup failed: ${(e as Error).message}` } }); return 'STILL_UNKNOWN'; }
    if (found) {
      await prisma.$transaction([
        prisma.publicationJob.update({ where: { id: job.id }, data: { state: 'SCHEDULED', nextCheckAt: new Date(Math.max(Date.now(), job.scheduledFor.getTime()) + 3 * 60_000) } }),
        prisma.publicationResult.upsert({ where: { jobId: job.id }, create: { jobId: job.id, providerPostId: found.providerPostId, providerStatus: 'PENDING' }, update: { providerPostId: found.providerPostId } }),
        prisma.advertisement.update({ where: { id: job.advertisementId }, data: { state: 'SCHEDULED' } }),
      ]);
      await audit({ actorLabel: 'worker', action: 'publication.reconciled_found', targetType: 'publication_job', targetId: job.id, details: { providerPostId: found.providerPostId } });
      return 'FOUND';
    }
    const lastAt = job.attempts[0]?.startedAt ?? job.updatedAt;
    if (Date.now() - lastAt.getTime() < ABSENCE_GRACE_MS) {
      await prisma.publicationJob.update({ where: { id: job.id }, data: { nextCheckAt: new Date(lastAt.getTime() + ABSENCE_GRACE_MS + 1000) } });
      return 'WAIT_GRACE';
    }
    if (!(await getSettings()).publishing.autoResubmitAfterAbsence) {
      // V8 default: an UNKNOWN submission is never re-sent automatically. Absence is recorded and an
      // operator decides (resubmitUnknownJob) — a search miss must not create a duplicate post.
      if (job.lastError !== ABSENT_MSG) {
        await prisma.publicationJob.update({ where: { id: job.id }, data: { lastError: ABSENT_MSG, nextCheckAt: new Date(Date.now() + 30 * 60_000) } });
        await notify('WARNING', 'PUBLISH_NEEDS_OPERATOR', 'نشر غير مؤكد بحاجة إلى قرارك', 'لم يُعثر على المنشور لدى Metricool. تحقق في Metricool ثم اضغط «إعادة الإرسال» أو «إلغاء» من صفحة المنشورات.', job.accountId);
      } else {
        await prisma.publicationJob.update({ where: { id: job.id }, data: { nextCheckAt: new Date(Date.now() + 30 * 60_000) } });
      }
      return 'NEEDS_OPERATOR';
    }
    if (job.attemptCount >= MAX_PUBLISH_ATTEMPTS) {
      await prisma.$transaction([
        prisma.publicationJob.update({ where: { id: job.id }, data: { state: 'FAILED', lastError: 'not found at provider after max attempts' } }),
        prisma.advertisement.update({ where: { id: job.advertisementId }, data: { state: 'FAILED', errorMessage: 'لم يُعثر على المنشور لدى المزود بعد عدة محاولات.' } }),
      ]);
      await notify('ERROR', 'PUBLISH_FAILED', 'فشل النشر بعد المطابقة', `المهمة ${job.id}`, job.accountId);
      return 'FAILED';
    }
    await prisma.$transaction([
      prisma.publicationJob.update({ where: { id: job.id }, data: { state: 'QUEUED', nextCheckAt: null } }),
      prisma.advertisement.update({ where: { id: job.advertisementId }, data: { state: 'QUEUED' } }),
    ]);
    await audit({ actorLabel: 'worker', action: 'publication.reconciled_absent_requeue', targetType: 'publication_job', targetId: job.id });
    await enq.publish(job.id);
    return 'REQUEUED';
  }

  if (job.state === 'SCHEDULED') {
    const postId = job.result?.providerPostId;
    if (!postId) { await prisma.publicationJob.update({ where: { id: job.id }, data: { state: 'UNKNOWN' } }); return 'MISSING_ID'; }
    let st;
    try { st = await adapter.getStatus(job.account.connection?.providerBrandId ?? '', postId, job.scheduledFor, job.account.timezone); }
    catch (e) { await prisma.publicationJob.update({ where: { id: job.id }, data: { nextCheckAt: new Date(Date.now() + 10 * 60_000), lastError: (e as Error).message } }); return 'CHECK_ERROR'; }
    if (st.kind === 'PUBLISHED') {
      await prisma.$transaction([
        prisma.publicationJob.update({ where: { id: job.id }, data: { state: 'PUBLISHED', nextCheckAt: null } }),
        prisma.publicationResult.update({ where: { jobId: job.id }, data: { providerStatus: 'PUBLISHED', publicUrl: st.publicUrl ?? null, verifiedAt: new Date() } }),
        prisma.advertisement.update({ where: { id: job.advertisementId }, data: { state: 'PUBLISHED' } }),
        prisma.socialAccount.update({ where: { id: job.accountId }, data: { lastPublishedAt: new Date() } }),
      ]);
      await audit({ actorLabel: 'worker', action: 'publication.verified_published', targetType: 'publication_job', targetId: job.id, details: { url: st.publicUrl ?? null } });
      return 'PUBLISHED';
    }
    if (st.kind === 'ERROR') {
      await prisma.$transaction([
        prisma.publicationJob.update({ where: { id: job.id }, data: { state: 'FAILED', lastError: st.message } }),
        prisma.publicationResult.update({ where: { jobId: job.id }, data: { providerStatus: 'ERROR' } }),
        prisma.advertisement.update({ where: { id: job.advertisementId }, data: { state: 'FAILED', errorMessage: st.message } }),
      ]);
      await notify('ERROR', 'PROVIDER_ERROR', 'المزود أبلغ عن فشل النشر', st.message, job.accountId);
      return 'FAILED';
    }
    if (st.kind === 'NOT_FOUND' || Date.now() > job.scheduledFor.getTime() + 6 * 3600_000) {
      await prisma.$transaction([
        prisma.publicationJob.update({ where: { id: job.id }, data: { state: 'UNKNOWN', nextCheckAt: new Date(Date.now() + 30 * 60_000) } }),
        prisma.advertisement.update({ where: { id: job.advertisementId }, data: { state: 'UNKNOWN' } }),
      ]);
      await notify('WARNING', 'PUBLISH_UNVERIFIED', 'تعذر تأكيد النشر', `المنشور ${postId} لم يُؤكد نشره من المزود.`, job.accountId);
      return 'UNVERIFIED';
    }
    await prisma.publicationJob.update({ where: { id: job.id }, data: { nextCheckAt: new Date(Date.now() + 5 * 60_000) } });
    return 'PENDING';
  }
  return 'NOOP';
}

/**
 * Operator decision for an UNKNOWN job. A fresh provider lookup runs first: if the post exists it is
 * adopted (no resubmission); only proven absence re-queues. `cancel` closes the job without sending.
 */
export async function resolveUnknownJob(jobId: string, action: 'resubmit' | 'cancel', actor: string) {
  const job = await prisma.publicationJob.findUniqueOrThrow({ where: { id: jobId } });
  if (job.state !== 'UNKNOWN') throw new AppError('BAD_STATE', `المهمة ليست في حالة غير مؤكدة (${job.state}).`, 409);
  if (action === 'cancel') {
    await prisma.$transaction([
      prisma.publicationJob.update({ where: { id: jobId }, data: { state: 'FAILED', lastError: `cancelled by ${actor}`, nextCheckAt: null } }),
      prisma.advertisement.update({ where: { id: job.advertisementId }, data: { state: 'FAILED', errorMessage: 'ألغاه المشغّل بعد نتيجة غير مؤكدة' } }),
    ]);
    await audit({ actorLabel: actor, action: 'publication.operator_cancel', targetType: 'publication_job', targetId: jobId });
    return 'CANCELLED';
  }
  const adapter = await getAdapter(job.provider);
  const found = await adapter.findExisting(await buildPublishRequest(jobId)); // throws → caller sees the error, nothing re-sent
  if (found) {
    await prisma.$transaction([
      prisma.publicationJob.update({ where: { id: jobId }, data: { state: 'SCHEDULED', lastError: null, nextCheckAt: new Date(Math.max(Date.now(), job.scheduledFor.getTime()) + 3 * 60_000) } }),
      prisma.publicationResult.upsert({ where: { jobId }, create: { jobId, providerPostId: found.providerPostId, providerStatus: 'PENDING' }, update: { providerPostId: found.providerPostId } }),
      prisma.advertisement.update({ where: { id: job.advertisementId }, data: { state: 'SCHEDULED' } }),
    ]);
    await audit({ actorLabel: actor, action: 'publication.operator_found', targetType: 'publication_job', targetId: jobId, details: { providerPostId: found.providerPostId } });
    return 'FOUND';
  }
  if (job.attemptCount >= MAX_PUBLISH_ATTEMPTS) throw new AppError('MAX_ATTEMPTS', `تجاوزت المهمة ${MAX_PUBLISH_ATTEMPTS} محاولات — أعد توليد الإعلان بدلًا من ذلك.`, 409);
  const moved = await prisma.publicationJob.updateMany({ where: { id: jobId, state: 'UNKNOWN' }, data: { state: 'QUEUED', nextCheckAt: null, lastError: null } });
  if (!moved.count) throw new AppError('CONFLICT', 'تغيّرت حالة المهمة.', 409);
  await prisma.advertisement.update({ where: { id: job.advertisementId }, data: { state: 'QUEUED' } });
  await audit({ actorLabel: actor, action: 'publication.operator_resubmit', targetType: 'publication_job', targetId: jobId });
  await enq.publish(jobId);
  return 'REQUEUED';
}

/** Periodic sweep: due reconciliations + re-enqueue QUEUED jobs whose retry time arrived. */
export async function reconcileSweep(now = new Date()) {
  const due = await prisma.publicationJob.findMany({ where: { state: { in: ['UNKNOWN', 'SCHEDULED'] }, OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: now } }] }, take: 100 });
  const results: Record<string, string> = {};
  for (const j of due) {
    try { results[j.id] = await reconcileJob(j.id); } catch (e) { results[j.id] = `ERROR: ${(e as Error).message}`; }
  }
  const queued = await prisma.publicationJob.findMany({ where: { state: 'QUEUED', OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: now } }] }, take: 100 });
  for (const j of queued) await enq.publish(j.id);
  return { reconciled: results, requeued: queued.length };
}
