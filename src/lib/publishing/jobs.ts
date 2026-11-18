import type { AdState, PublicationJob } from '@prisma/client';
import { splitJobs } from './channels';
import { prisma } from '../db';
import { getSettings } from '../settings';
import { audit } from '../audit';
import { AppError, KillSwitchError } from '../errors';
import { assertTransition } from './state-machine';
import { enq } from '../queue/queues';
import type { QcReport } from '../qc';
import { emitEvent } from '../integrations/events';
import { bundleSha, publishableMedia } from './media';
import { targetNetworks } from './publisher';
import { lockAccount, spacedTime } from './spacing';
import { hasQcOverride, type QcOverride } from './qc-override';
import { storage } from '../storage';

/** SHA-256 recorded at render time for the asset that will actually be published (video for Reels). */
export async function primaryMediaSha(adId: string) {
  const ad = await prisma.advertisement.findUniqueOrThrow({ where: { id: adId }, include: { media: true } });
  const list = publishableMedia(ad);
  if (!list.length || (ad.format === 'IMAGE_CAROUSEL' && list.length < 4)) throw new AppError('NEEDS_ASSET', 'ملفات التصميم النهائية غير مكتملة — لا يمكن الاعتماد.', 409);
  return bundleSha(list.map((m) => m.sha256));
}

/** Optimistic state change: only succeeds if the row is still in `from`. Returns false if someone else moved it. */
export async function moveAd(adId: string, from: AdState, to: AdState, data: Record<string, unknown> = {}) {
  assertTransition(from, to);
  const r = await prisma.advertisement.updateMany({ where: { id: adId, state: from }, data: { state: to, ...data } });
  return r.count === 1;
}

export async function approveAdvertisement(adId: string, user: { id: string; email: string }, note?: string) {
  const ad = await prisma.advertisement.findUniqueOrThrow({ where: { id: adId } });
  if (ad.state !== 'QUALITY_REVIEW') throw new AppError('BAD_STATE', `لا يمكن اعتماد إعلان في الحالة ${ad.state}.`, 409);
  if (!ad.qcPassed && !hasQcOverride(ad)) throw new AppError('QC_FAILED', 'لا يمكن اعتماد إعلان لم يجتز فحص الجودة. أعد التوليد أو ارفضه.', 409);
  const mediaSha256 = await primaryMediaSha(adId);
  if (!(await moveAd(adId, 'QUALITY_REVIEW', 'APPROVED'))) throw new AppError('CONFLICT', 'تغيرت حالة الإعلان، حدّث الصفحة.', 409);
  // approval is bound to the exact bytes the human saw (SHA-256); publisher refuses anything else
  const bound = await prisma.approvalRequest.updateMany({ where: { advertisementId: adId, status: 'PENDING' }, data: { status: 'APPROVED', decidedById: user.id, decidedAt: new Date(), note, mediaSha256 } });
  if (!bound.count) await prisma.approvalRequest.create({ data: { advertisementId: adId, reason: 'DIRECT_APPROVAL', status: 'APPROVED', decidedById: user.id, decidedAt: new Date(), note, mediaSha256 } });
  await audit({ actorId: user.id, actorLabel: user.email, action: 'ad.approve', targetType: 'advertisement', targetId: adId, details: { note: note ?? null } });
  await emitEvent('ad.approved', { adId, accountId: ad.accountId, by: user.email, mediaSha256 });
  // If the ad came from a scheduler slot that is still in the future, keep that slot.
  const sched = ad.scheduleId ? await prisma.publicationSchedule.findUnique({ where: { id: ad.scheduleId } }) : null;
  const s = await getSettings();
  const futureSlot = sched && sched.slotAt.getTime() > Date.now() + s.scheduleLeadMinutes * 60_000;
  if (sched && futureSlot && !s.killSwitch && (s.autoPublishGlobal || sched.campaignId)) {
    try { return await createPublicationJob(adId, sched.slotAt, user.email); }
    catch (e) {
      // approved, but the account is not connected / design not publishable (e.g. dry-run): keep it approved
      if (e instanceof AppError && ['NOT_CONNECTED', 'DRY_RUN', 'QC_FAILED', 'ACCOUNT_PAUSED'].includes(e.code)) return null;
      throw e;
    }
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
  await emitEvent('ad.rejected', { adId, accountId: ad.accountId, by: user.email, note: note ?? null });
}

/** Autonomous path: only for QC-publishable ads; records an audit entry attributed to the scheduler. */
export async function autoApproveAndQueue(adId: string, at?: Date) {
  const ad = await prisma.advertisement.findUniqueOrThrow({ where: { id: adId }, include: { schedule: true } });
  const qc = ad.qcReport as unknown as QcReport | null;
  if (!qc?.publishable || qc.requiresHuman || ad.dryRun) return null; // AI-drawn text always needs a human
  const mediaSha256 = await primaryMediaSha(adId);
  if (!(await moveAd(adId, 'QUALITY_REVIEW', 'APPROVED'))) return null;
  await prisma.approvalRequest.create({ data: { advertisementId: adId, reason: 'AUTONOMOUS', status: 'APPROVED', decidedAt: new Date(), note: 'scheduler auto-approval (account authorised)', mediaSha256 } });
  await audit({ actorLabel: 'scheduler', action: 'ad.auto_approve', targetType: 'advertisement', targetId: adId, details: { mediaSha256 } });
  const when = at ?? ad.schedule?.slotAt ?? new Date();
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
  if (!qc?.publishable && !hasQcOverride(ad)) throw new AppError('QC_FAILED', 'الإعلان غير صالح للنشر وفق فحص الجودة.', 409);
  if (ad.account.paused) throw new AppError('ACCOUNT_PAUSED', `الحساب موقوف مؤقتًا${ad.account.pausedReason ? ` (${ad.account.pausedReason})` : ''} — ألغِ الإيقاف أولًا.`, 409);
  const conn = ad.account.connection;
  if (!conn || conn.status !== 'CONNECTED' || !conn.canPublish || !conn.providerBrandId) {
    throw new AppError('NOT_CONNECTED', 'الحساب غير مرتبط بمزود نشر مؤكد أو لا يملك صلاحية النشر.', 412);
  }
  const lead = s.scheduleLeadMinutes * 60_000;
  const when = new Date(Math.max(scheduledFor.getTime(), Date.now() + lead)); // never in the past
  const idempotencyKey = `pub:${ad.id}:${ad.accountId}:${conn.provider}`;

  const existing = await prisma.publicationJob.findUnique({ where: { idempotencyKey } });
  if (existing) return existing;
  // Google Business Profile (no phones/hashtags) and short-text networks get their own satellite jobs.
  const nets = targetNetworks(ad.account.platform, ad.channels);
  const [main, ...satellites] = splitJobs(nets);

  let job: PublicationJob;
  const satelliteIds: string[] = [];
  let slot = when;
  try {
    job = await prisma.$transaction(async (tx) => {
      // never two posts on the same account closer than publishing.minGapMinutes (campaign + schedule collisions)
      await lockAccount(tx, ad.accountId);
      slot = await spacedTime(tx, ad.accountId, when, s.publishing.minGapMinutes);
      const moved = await tx.advertisement.updateMany({ where: { id: ad.id, state: 'APPROVED' }, data: { state: 'QUEUED' } });
      if (moved.count !== 1) throw new AppError('BAD_STATE', 'يجب أن يكون الإعلان معتمدًا قبل جدولته.', 409);
      const primary = await tx.publicationJob.create({ data: { idempotencyKey, advertisementId: ad.id, accountId: ad.accountId, provider: conn.provider, state: 'QUEUED', scheduledFor: slot, networks: main } });
      // short-text networks (X, Threads, Pinterest) and Google Business get their own satellite job → text fitted to each network
      for (const sat of satellites) satelliteIds.push((await tx.publicationJob.create({ data: { idempotencyKey: `${idempotencyKey}:${sat[0]}`, advertisementId: ad.id, accountId: ad.accountId, provider: conn.provider, state: 'QUEUED', scheduledFor: slot, networks: sat, primary: false } })).id);
      return primary;
    });
  } catch (e) {
    const again = await prisma.publicationJob.findUnique({ where: { idempotencyKey } });
    if (again) return again; // lost a race to another request — idempotent result
    throw e;
  }
  await audit({ actorLabel: actor, action: 'publication.queue', targetType: 'publication_job', targetId: job.id, details: { adId, scheduledFor: slot.toISOString(), ...(slot.getTime() !== when.getTime() ? { requestedFor: when.toISOString(), movedForGap: true } : {}) } });
  await enq.publish(job.id);
  for (const id of satelliteIds) await enq.publish(id);
  return job;
}

/**
 * "نشر الآن": approve (if pending) and queue for the earliest safe time.
 * With `overrideQc` a person publishes despite failed quality checks — recorded on the ad and in the audit log.
 * Dry-run previews, the kill switch, a paused/unconnected account and file integrity are never overridden.
 */
export async function publishNow(adId: string, user: { id: string; email: string }, opts: { overrideQc?: boolean; reason?: string | null } = {}) {
  const s = await getSettings();
  if (s.killSwitch) throw new KillSwitchError();
  let ad = await prisma.advertisement.findUniqueOrThrow({ where: { id: adId } });
  // «فشل» but the final files are complete (e.g. a later step was killed) → a person can still publish it
  if (ad.state === 'FAILED') ad = await recoverFailedForPublish(ad, user);
  const qc = ad.qcReport as unknown as QcReport | null;
  if (opts.overrideQc && ad.dryRun) throw new AppError('DRY_RUN', 'هذا الإعلان معاينة تجريبية (Dry-run) ولا يمكن نشره حتى مع تجاوز الجودة. فعّل OpenAI وأعد التوليد.', 409);
  if (opts.overrideQc && !qc?.publishable && !hasQcOverride(ad) && ['QUALITY_REVIEW', 'APPROVED'].includes(ad.state)) {
    await primaryMediaSha(adId); // final files must exist
    const reason = opts.reason?.trim().slice(0, 500) || null;
    const failed = (qc?.checks ?? []).filter((c) => !c.passed).map((c) => c.label);
    const qcOverride: QcOverride = { by: user.email, at: new Date().toISOString(), reason, failed };
    await prisma.advertisement.update({ where: { id: adId }, data: { options: { ...((ad.options ?? {}) as object), qcOverride } } });
    await audit({ actorId: user.id, actorLabel: user.email, action: 'ad.qc_override', targetType: 'advertisement', targetId: adId, details: { reason, failed } });
  }
  if (ad.state === 'QUALITY_REVIEW') await approveAdvertisement(adId, user, opts.overrideQc ? 'publish-now (QC override)' : 'publish-now');
  const fresh = await prisma.advertisement.findUniqueOrThrow({ where: { id: adId } });
  if (fresh.state === 'QUEUED') return prisma.publicationJob.findFirstOrThrow({ where: { advertisementId: adId } });
  if (fresh.state !== 'APPROVED') throw new AppError('BAD_STATE', `لا يمكن نشر إعلان في الحالة ${fresh.state}.`, 409);
  await audit({ actorId: user.id, actorLabel: user.email, action: 'ad.publish_now', targetType: 'advertisement', targetId: adId, details: opts.overrideQc ? { qcOverride: true } : undefined });
  return createPublicationJob(adId, new Date(), user.email);
}

/**
 * A design marked FAILED whose final files are complete and intact goes back to review so «نشر الآن» can publish it.
 * Refused when it was (or may have been) published already — never a duplicate post — or when files are missing.
 */
async function recoverFailedForPublish(ad: Awaited<ReturnType<typeof prisma.advertisement.findUniqueOrThrow>>, user: { id: string; email: string }) {
  if (ad.dryRun) throw new AppError('DRY_RUN', 'هذا الإعلان معاينة تجريبية (Dry-run) ولا يمكن نشره. فعّل OpenAI وأعد التوليد.', 409);
  const jobs = await prisma.publicationJob.findMany({ where: { advertisementId: ad.id }, select: { id: true, state: true, idempotencyKey: true } });
  if (jobs.some((j) => ['PUBLISHED', 'SCHEDULED'].includes(j.state))) throw new AppError('ALREADY_PUBLISHED', 'هذا التصميم نُشر أو جُدول بالفعل على المزود — لن يُنشر مرة ثانية.', 409);
  if (jobs.some((j) => ['PUBLISHING', 'UNKNOWN', 'QUEUED'].includes(j.state))) throw new AppError('IN_FLIGHT', 'حالة النشر السابقة غير مؤكدة بعد — انتظر التحقق من المزود (دقائق) ثم أعد المحاولة، حتى لا يُنشر مرتين.', 409);
  await primaryMediaSha(ad.id); // every final file present (throws NEEDS_ASSET otherwise)
  // the earlier failed attempt keeps its record; its idempotency key is retired so a fresh request can be made
  for (const j of jobs) if (j.state === 'FAILED' || j.state === 'REJECTED') await prisma.publicationJob.update({ where: { id: j.id }, data: { idempotencyKey: `${j.idempotencyKey}:retired:${j.id}` } });
  const qcr = ad.qcReport as unknown as QcReport | null;
  if (!(await moveAd(ad.id, 'FAILED', 'QUALITY_REVIEW', { errorMessage: null, ...(qcr?.passed ? { qcPassed: true } : {}) }))) throw new AppError('CONFLICT', 'تغيرت حالة الإعلان، حدّث الصفحة.', 409);
  await audit({ actorId: user.id, actorLabel: user.email, action: 'ad.recover_failed', targetType: 'advertisement', targetId: ad.id, details: { previousError: ad.errorMessage?.slice(0, 300) ?? null, retiredJobs: jobs.length } });
  return prisma.advertisement.findUniqueOrThrow({ where: { id: ad.id } });
}

/**
 * Deletes a design from the system (images, video, failed / cancelled publishing attempts). Never a design that is
 * on Instagram or on its way there: published or scheduled posts stay as history (delete them on Instagram itself),
 * queued or unconfirmed ones must be cancelled first. The audit log keeps who deleted what.
 */
export async function deleteAdvertisement(adId: string, user: { id: string; email: string }) {
  const ad = await prisma.advertisement.findUniqueOrThrow({ where: { id: adId }, include: { media: { select: { storageKey: true } }, jobs: { select: { id: true, state: true } }, account: { select: { name: true } } } });
  if (ad.state === 'PUBLISHED' || ad.jobs.some((j) => ['PUBLISHED', 'SCHEDULED'].includes(j.state))) throw new AppError('PUBLISHED', 'هذا التصميم منشور أو مجدول على المزود — يبقى في السجل. لإزالته من إنستغرام احذفه من التطبيق أو من Metricool.', 409);
  if (['QUEUED', 'PUBLISHING', 'UNKNOWN', 'GENERATING'].includes(ad.state) || ad.jobs.some((j) => ['QUEUED', 'PUBLISHING', 'UNKNOWN'].includes(j.state))) throw new AppError('IN_FLIGHT', 'التصميم قيد التوليد أو الإرسال الآن — ارفضه أو انتظر انتهاء العملية ثم احذفه.', 409);
  await prisma.$transaction([
    prisma.publicationJob.deleteMany({ where: { advertisementId: adId } }),
    prisma.advertisement.delete({ where: { id: adId } }),
  ]);
  for (const m of ad.media) await storage().remove(m.storageKey).catch(() => undefined);
  await audit({ actorId: user.id, actorLabel: user.email, action: 'ad.delete', targetType: 'advertisement', targetId: adId, details: { headline: ad.headline, account: ad.account.name, state: ad.state, files: ad.media.length } });
  return { files: ad.media.length };
}

/** Instagram / the provider could not DOWNLOAD our media (server busy or down at that moment) — worth one retry. */
export const isTransientMediaError = (msg: string | null | undefined) =>
  !!msg && /media could not be fetched|could not (be )?download|failed to (fetch|download)|download(ing)? (the )?media|timed? ?out|timeout|temporarily unavailable|try again later/i.test(msg);

/**
 * One automatic retry, 30 minutes later, when a post failed only because the provider could not fetch the file
 * (e.g. the server was overloaded). Same approved files (the publisher re-checks their SHA-256), the 30-minute gap
 * per account is kept, never more than one automatic retry per design, nothing while the kill switch is on.
 */
export async function autoRetryTransient(jobId: string, now = new Date()) {
  const s = await getSettings();
  if (s.killSwitch) return null;
  const job = await prisma.publicationJob.findUniqueOrThrow({ where: { id: jobId }, include: { advertisement: true } });
  if (!job.primary || job.state !== 'FAILED' || !isTransientMediaError(job.lastError) || job.advertisement.state !== 'FAILED' || job.advertisement.dryRun) return null;
  if (await prisma.publicationJob.count({ where: { advertisementId: job.advertisementId, idempotencyKey: { contains: ':retired:' } } })) return null; // retried before
  if (!(await prisma.approvalRequest.count({ where: { advertisementId: job.advertisementId, status: 'APPROVED' } }))) return null;
  const when = new Date(now.getTime() + 30 * 60_000);
  const fresh = await prisma.$transaction(async (tx) => {
    await lockAccount(tx, job.accountId);
    const slot = await spacedTime(tx, job.accountId, when, s.publishing.minGapMinutes);
    await tx.publicationJob.update({ where: { id: job.id }, data: { idempotencyKey: `${job.idempotencyKey}:retired:${job.id}` } });
    const moved = await tx.advertisement.updateMany({ where: { id: job.advertisementId, state: 'FAILED' }, data: { state: 'QUEUED', errorMessage: null } });
    if (moved.count !== 1) throw new AppError('CONFLICT', 'state changed', 409);
    return tx.publicationJob.create({ data: { idempotencyKey: job.idempotencyKey, advertisementId: job.advertisementId, accountId: job.accountId, provider: job.provider, state: 'QUEUED', scheduledFor: slot, networks: job.networks, primary: true } });
  });
  await audit({ actorLabel: 'worker', action: 'publication.auto_retry', targetType: 'publication_job', targetId: fresh.id, details: { previousJob: job.id, reason: job.lastError?.slice(0, 200) ?? null, scheduledFor: fresh.scheduledFor.toISOString() } });
  await enq.publish(fresh.id);
  return fresh;
}
