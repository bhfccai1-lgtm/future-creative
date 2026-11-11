import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { audit, notify } from '../audit';
import { getAdapter } from './registry';
import type { PublishRequest } from './types';
import { signedMediaUrl, storage } from '../storage';
import { loadApprovedLogo } from '../brand/logo';
import { rateLimit } from '../security/rate-limit';
import { getBusiness, locationsOf } from '../business';
import type { QcReport } from '../qc';
import { enq } from '../queue/queues';
import type { SocialPlatform } from '@prisma/client';
import { fitCaption } from './caption';
import { getSettings } from '../settings';
import { sha256 } from '../crypto';
import { log } from '../ops/log';
import { emitEvent } from '../integrations/events';

export type PublishResult = 'SKIPPED_LOCKED' | 'KILL_SWITCH' | 'ACCOUNT_PAUSED' | 'NOT_DUE' | 'SCHEDULED' | 'FAILED' | 'UNKNOWN' | 'RATE_LIMITED';

async function fail(jobId: string, adId: string, reason: string, accountId: string) {
  await prisma.$transaction([
    prisma.publicationJob.update({ where: { id: jobId }, data: { state: 'FAILED', lastError: reason, lockedBy: null } }),
    prisma.advertisement.update({ where: { id: adId }, data: { state: 'FAILED', errorMessage: reason } }),
  ]);
  await notify('ERROR', 'PUBLISH_FAILED', 'فشل النشر', reason, accountId);
  await audit({ actorLabel: 'worker', action: 'publication.failed', targetType: 'publication_job', targetId: jobId, details: { reason } });
  await emitEvent('publication.failed', { jobId, adId, accountId, reason });
}

export function contactFooter(lang: string, locs: { nameAr: string; nameEn: string; nameMl?: string; phone: string }[]) {
  return '📞 ' + locs.map((l) => `${lang === 'ar' ? l.nameAr : lang === 'ml' ? l.nameMl ?? l.nameEn : l.nameEn} ${l.phone}`).join(' | ');
}

/** Text that fits every chosen network; optionally moves hashtags to the first comment (Instagram/Facebook only). */
function captionFor(caption: string, contactLine: string, networks: SocialPlatform[], hashtagsInFirstComment: boolean) {
  const commentOk = hashtagsInFirstComment && networks.every((n) => n === 'instagram' || n === 'facebook');
  const fit = fitCaption(caption, contactLine, networks, { hashtagsSeparately: commentOk });
  return { text: fit.text, firstComment: commentOk && fit.hashtags.length ? fit.hashtags.join(' ') : undefined };
}

/** Publishing networks: the account's own platform first, then any extra chosen channels. */
export function targetNetworks(own: SocialPlatform, chosen: SocialPlatform[] | null | undefined): SocialPlatform[] {
  if (!chosen?.length) return [own];
  const unique = [...new Set(chosen)];
  return unique.includes(own) ? [own, ...unique.filter((n) => n !== own)] : unique;
}

/** Channels the provider brand actually has linked (from the verified connection snapshot). */
export function unavailableChannels(networks: SocialPlatform[], snapshot: unknown, format: string): string[] {
  const linked = ((snapshot as { networks?: { network: string }[] } | null)?.networks ?? []).map((n) => n.network);
  const out: string[] = [];
  for (const n of networks) {
    if (linked.length && !linked.includes(n)) out.push(`${n}: غير مرتبط بالعلامة في Metricool`);
    if (n === 'youtube' && format !== 'REEL_VIDEO') out.push('youtube: يتطلب فيديو (Reel)');
  }
  return out;
}

export async function buildPublishRequest(jobId: string): Promise<PublishRequest> {
  const job = await prisma.publicationJob.findUniqueOrThrow({ where: { id: jobId }, include: { advertisement: { include: { media: true, product: true } }, account: { include: { connection: true } } } });
  const ad = job.advertisement;
  const isVideo = ad.format === 'REEL_VIDEO';
  const main = ad.media.find((m) => m.role === (isVideo ? 'VIDEO' : 'FINAL'));
  if (!main) throw new Error('Final media asset missing');
  const thumb = ad.media.find((m) => m.role === 'THUMBNAIL');
  const business = await getBusiness();
  const opts = (ad.options ?? {}) as { audio?: string | null; audioQuery?: string | null };
  const networks = targetNetworks(job.account.platform, ad.channels);
  return {
    idempotencyKey: job.idempotencyKey,
    providerBrandId: job.account.connection!.providerBrandId!,
    networks,
    instagramAudio: ad.format === 'REEL_VIDEO' && opts.audio === 'instagram' && opts.audioQuery ? opts.audioQuery : undefined,
    format: ad.format,
    publishAt: job.scheduledFor,
    timezone: job.account.timezone,
    ...captionFor(ad.caption ?? '', contactFooter(ad.language, locationsOf(business)), networks, (await getSettings()).metricool.hashtagsInFirstComment),
    altText: [ad.headline, ad.product?.titleAr && ad.language === 'ar' ? ad.product.titleAr : ad.product?.titleEn, 'مطبعة إبداع المستقبل — Future Creative Printing'].filter(Boolean).join(' — '),
    mediaUrls: [signedMediaUrl(main.storageKey)],
    thumbnailUrl: thumb ? signedMediaUrl(thumb.storageKey) : undefined,
    title: ad.headline ?? undefined,
    aiGenerated: true,
  };
}

/**
 * Sends ONE publication request to the provider. Safety properties:
 *  - atomic claim (QUEUED → PUBLISHING with updateMany): two workers can never submit the same job
 *  - kill switch checked before claiming
 *  - full pre-flight (QC, logo fingerprint, authorisation, media availability, not in the past)
 *  - UNCERTAIN results become UNKNOWN and are reconciled — never blindly retried
 */
export async function processPublishJob(jobId: string, workerId: string): Promise<PublishResult> {
  const s = await getSettings();
  if (s.killSwitch) return 'KILL_SWITCH';
  const pre = await prisma.publicationJob.findUnique({ where: { id: jobId } });
  if (!pre || pre.state !== 'QUEUED') return 'SKIPPED_LOCKED';
  if (pre.nextCheckAt && pre.nextCheckAt.getTime() > Date.now()) return 'NOT_DUE';
  const acc = await prisma.socialAccount.findUnique({ where: { id: pre.accountId }, select: { paused: true } });
  if (acc?.paused) {
    // hold — nothing is sent while the account is paused; re-checked by the reconcile sweep
    await prisma.publicationJob.update({ where: { id: jobId }, data: { nextCheckAt: new Date(Date.now() + 15 * 60_000), lastError: 'account paused' } });
    return 'ACCOUNT_PAUSED';
  }

  const claim = await prisma.publicationJob.updateMany({
    where: { id: jobId, state: 'QUEUED' },
    data: { state: 'PUBLISHING', lockedBy: workerId, lockedAt: new Date(), attemptCount: { increment: 1 } },
  });
  if (claim.count !== 1) return 'SKIPPED_LOCKED';
  await prisma.advertisement.updateMany({ where: { id: pre.advertisementId, state: 'QUEUED' }, data: { state: 'PUBLISHING' } });

  const job = await prisma.publicationJob.findUniqueOrThrow({ where: { id: jobId }, include: { advertisement: { include: { media: true } }, account: { include: { connection: true, business: true } } } });
  const ad = job.advertisement;

  // ── Pre-flight validation ──
  const qc = ad.qcReport as unknown as QcReport | null;
  if (ad.dryRun || !qc?.publishable) { await fail(job.id, ad.id, 'الإعلان غير صالح للنشر (فحص الجودة/وضع التجربة).', job.accountId); return 'FAILED'; }
  try {
    const logo = await loadApprovedLogo(job.account.businessId);
    if (logo.sha256 !== ad.logoSha256) { await fail(job.id, ad.id, 'الشعار المعتمد تغيّر منذ إنشاء التصميم — أعد التوليد.', job.accountId); return 'FAILED'; }
  } catch (e) { await fail(job.id, ad.id, (e as Error).message, job.accountId); return 'FAILED'; }
  const conn = job.account.connection;
  if (!conn || conn.status !== 'CONNECTED' || !conn.canPublish) { await fail(job.id, ad.id, 'صلاحية النشر غير صالحة أو الحساب غير مرتبط.', job.accountId); return 'FAILED'; }
  if (conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() < Date.now()) {
    await prisma.socialConnection.update({ where: { id: conn.id }, data: { status: 'EXPIRED', canPublish: false } });
    await fail(job.id, ad.id, 'انتهت صلاحية رمز الوصول للحساب.', job.accountId); return 'FAILED';
  }
  const bad = unavailableChannels(targetNetworks(job.account.platform, ad.channels), conn.providerSnapshot, ad.format);
  if (bad.length) { await fail(job.id, ad.id, `قنوات نشر غير متاحة: ${bad.join('؛ ')}`, job.accountId); return 'FAILED'; }
  const main = ad.media.find((m) => m.role === (ad.format === 'REEL_VIDEO' ? 'VIDEO' : 'FINAL'));
  if (!main || !(await storage().exists(main.storageKey))) { await fail(job.id, ad.id, 'ملف الوسائط النهائي غير متاح.', job.accountId); return 'FAILED'; }
  // Integrity: the bytes on disk must be exactly the bytes rendered AND the bytes approved.
  const actual = sha256(await storage().get(main.storageKey));
  if (actual !== main.sha256) { await fail(job.id, ad.id, 'ملف التصميم تغيّر بعد إنشائه (بصمة SHA-256 غير مطابقة) — أعد التوليد والاعتماد.', job.accountId); return 'FAILED'; }
  const approval = await prisma.approvalRequest.findFirst({ where: { advertisementId: ad.id, status: 'APPROVED' }, orderBy: { decidedAt: 'desc' } });
  if (approval?.mediaSha256 && approval.mediaSha256 !== actual) { await fail(job.id, ad.id, 'الملف الحالي ليس الملف الذي تم اعتماده — أعد الاعتماد.', job.accountId); return 'FAILED'; }
  if (job.scheduledFor.getTime() < Date.now() + 2 * 60_000) {
    const newTime = new Date(Date.now() + s.scheduleLeadMinutes * 60_000);
    await prisma.publicationJob.update({ where: { id: job.id }, data: { scheduledFor: newTime } });
  }

  // ── Provider-side rate limit (shared across workers) ──
  const rl = await rateLimit(`provider:${job.provider}`, s.metricool.requestsPerMinute, 60);
  if (!rl.ok) {
    await prisma.publicationJob.update({ where: { id: job.id }, data: { state: 'QUEUED', lockedBy: null, nextCheckAt: new Date(Date.now() + rl.retryAfterSec * 1000), attemptCount: { decrement: 1 } } });
    await prisma.advertisement.updateMany({ where: { id: ad.id, state: 'PUBLISHING' }, data: { state: 'QUEUED' } });
    await enq.publish(job.id, rl.retryAfterSec * 1000);
    return 'RATE_LIMITED';
  }

  const req = await buildPublishRequest(job.id);
  const attemptNo = job.attemptCount;
  const attempt = await prisma.publicationAttempt.create({ data: { jobId: job.id, attemptNo, requestSummary: { networks: req.networks, format: req.format, publishAt: req.publishAt.toISOString(), brandId: req.providerBrandId, media: req.mediaUrls.map((u) => u.split('?')[0]) } } });

  let outcome;
  log.info('publish.submit', { correlationId: job.idempotencyKey, jobId: job.id, accountId: job.accountId, attemptNo, networks: req.networks });
  try { outcome = await (await getAdapter(job.provider)).submit(req); }
  catch (e) { outcome = { kind: 'UNCERTAIN' as const, message: (e as Error).message }; }

  await prisma.publicationAttempt.update({
    where: { id: attempt.id },
    data: { outcome: outcome.kind, httpStatus: 'httpStatus' in outcome ? outcome.httpStatus ?? null : null, finishedAt: new Date(), responseSummary: (('raw' in outcome ? outcome.raw : null) ?? null) as Prisma.InputJsonValue, error: 'message' in outcome ? outcome.message : null },
  });

  log.info('publish.outcome', { correlationId: job.idempotencyKey, jobId: job.id, outcome: outcome.kind, httpStatus: 'httpStatus' in outcome ? outcome.httpStatus : undefined });
  switch (outcome.kind) {
    case 'ACCEPTED':
      await prisma.$transaction([
        prisma.publicationJob.update({ where: { id: job.id }, data: { state: 'SCHEDULED', lockedBy: null, nextCheckAt: new Date(req.publishAt.getTime() + 3 * 60_000), lastError: null } }),
        prisma.publicationResult.upsert({ where: { jobId: job.id }, create: { jobId: job.id, providerPostId: outcome.providerPostId, providerStatus: outcome.providerStatus, rawResponse: outcome.raw as Prisma.InputJsonValue }, update: { providerPostId: outcome.providerPostId, providerStatus: outcome.providerStatus } }),
        prisma.advertisement.update({ where: { id: ad.id }, data: { state: 'SCHEDULED' } }),
      ]);
      await audit({ actorLabel: 'worker', action: 'publication.scheduled', targetType: 'publication_job', targetId: job.id, details: { providerPostId: outcome.providerPostId } });
      await emitEvent('publication.scheduled', { jobId: job.id, adId: ad.id, accountId: job.accountId, account: job.account.name, publishAt: req.publishAt.toISOString(), networks: req.networks, providerPostId: outcome.providerPostId });
      return 'SCHEDULED';
    case 'REJECTED':
      await fail(job.id, ad.id, `رفض المزود الطلب (${outcome.httpStatus}): ${outcome.message}`, job.accountId);
      if (outcome.httpStatus === 401 || outcome.httpStatus === 403) {
        await prisma.socialConnection.update({ where: { id: conn.id }, data: { status: 'INSUFFICIENT_PERMISSIONS', canPublish: false, lastError: outcome.message } });
      }
      return 'FAILED';
    case 'RATE_LIMITED':
      await prisma.publicationJob.update({ where: { id: job.id }, data: { state: 'QUEUED', lockedBy: null, nextCheckAt: new Date(Date.now() + outcome.retryAfterSec * 1000), lastError: 'provider rate limit' } });
      await prisma.advertisement.updateMany({ where: { id: ad.id, state: 'PUBLISHING' }, data: { state: 'QUEUED' } });
      await enq.publish(job.id, outcome.retryAfterSec * 1000);
      return 'RATE_LIMITED';
    case 'UNCERTAIN':
      await prisma.$transaction([
        prisma.publicationJob.update({ where: { id: job.id }, data: { state: 'UNKNOWN', lockedBy: null, nextCheckAt: new Date(Date.now() + 2 * 60_000), lastError: outcome.message } }),
        prisma.advertisement.update({ where: { id: ad.id }, data: { state: 'UNKNOWN' } }),
      ]);
      await emitEvent('publication.unknown', { jobId: job.id, adId: ad.id, accountId: job.accountId, account: job.account.name, error: outcome.message, action: 'reconcile then operator decision in /posts' });
      await notify('WARNING', 'PUBLISH_UNKNOWN', 'نتيجة نشر غير مؤكدة', `لم يتأكد إنشاء المنشور لدى المزود (${outcome.message}). ستتم المطابقة قبل أي إعادة محاولة.`, job.accountId);
      return 'UNKNOWN';
  }
}
