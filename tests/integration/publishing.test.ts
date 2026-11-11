import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { generateAdvertisement } from '@/lib/pipeline/generate';
import { setAiProviderOverride } from '@/lib/ai';
import { setPublishingAdapterOverride } from '@/lib/publishing/registry';
import { approveAdvertisement, createPublicationJob, publishNow, rejectAdvertisement } from '@/lib/publishing/jobs';
import { processPublishJob } from '@/lib/publishing/publisher';
import { reconcileJob, resolveUnknownJob } from '@/lib/publishing/reconcile';
import { recoverAfterRestart } from '@/lib/ops/recovery';
import { updateSettings } from '@/lib/settings';
import { KillSwitchError } from '@/lib/errors';
import { captured, captureQueues, FakeAdapter, FakeAiProvider, resetDb, seedBase } from './helpers';

let adapter: FakeAdapter;
const admin = { id: '', email: 'admin@test.bh' };

async function setup(mode: 'MANUAL' | 'ASSISTED' | 'AUTONOMOUS' = 'MANUAL', accounts = 2) {
  const base = await seedBase({ accounts, settings: (s) => ({ ...s, publishingMode: mode, ai: { ...s.ai, dryRun: false } }) });
  admin.id = base.admin.id;
  setAiProviderOverride(new FakeAiProvider());
  adapter = new FakeAdapter(); setPublishingAdapterOverride(adapter);
  return base;
}
async function readyAd(accountId: string) {
  const r = await generateAdvertisement({ accountId, createdBy: 'tester' });
  expect(r.advertisement.state).toBe('QUALITY_REVIEW');
  return r.advertisement;
}

beforeEach(async () => { await resetDb(); captureQueues(); });

describe('manual approval workflow', () => {
  it('MANUAL mode: nothing is queued until a human approves; approval is audited', async () => {
    const { accounts } = await setup('MANUAL');
    const ad = await readyAd(accounts[0].id);
    expect(await prisma.publicationJob.count()).toBe(0);
    await approveAdvertisement(ad.id, admin);
    expect((await prisma.advertisement.findUniqueOrThrow({ where: { id: ad.id } })).state).toBe('APPROVED');
    expect(await prisma.approvalRequest.count({ where: { status: 'APPROVED', decidedById: admin.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'ad.approve', targetId: ad.id } })).toBe(1);
    expect(await prisma.publicationJob.count()).toBe(0);
  });

  it('cannot approve a design that failed QC; rejected ads can never be queued', async () => {
    const { accounts } = await setup('MANUAL');
    const ad = await readyAd(accounts[0].id);
    await prisma.advertisement.update({ where: { id: ad.id }, data: { qcPassed: false } });
    await expect(approveAdvertisement(ad.id, admin)).rejects.toThrow(/فحص الجودة/);
    await rejectAdvertisement(ad.id, admin, 'bad');
    await expect(publishNow(ad.id, admin)).rejects.toThrow();
    expect(await prisma.publicationJob.count()).toBe(0);
  });

  it('dry-run ads are refused at publication time', async () => {
    const { accounts, admin: a } = await seedBase();
    setPublishingAdapterOverride(new FakeAdapter());
    const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't' });
    await approveAdvertisement(r.advertisement.id, { id: a.id, email: a.email });
    await expect(createPublicationJob(r.advertisement.id, new Date(), 'x')).rejects.toThrow(/Dry-run/);
  });
});

describe('autonomous authorisation', () => {
  it('AUTONOMOUS mode without per-account authorisation still requires approval', async () => {
    const { accounts } = await setup('AUTONOMOUS');
    await updateSettings((s) => ({ ...s, autonomousAuthorizedAt: new Date().toISOString() }));
    await prisma.socialAccount.update({ where: { id: accounts[0].id }, data: { autoPublishEnabled: true } });
    const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 'scheduler' });
    expect(r.queued).toBe(false);
    expect(await prisma.approvalRequest.count({ where: { status: 'PENDING' } })).toBe(1);
  });

  it('AUTONOMOUS mode requires the global authorisation record too', async () => {
    const { accounts } = await setup('AUTONOMOUS');
    await prisma.socialAccount.update({ where: { id: accounts[0].id }, data: { autoPublishEnabled: true, autonomousAuthorized: true } });
    const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 'scheduler' });
    expect(r.queued).toBe(false);
  });

  it('fully authorised account: QC-passed scheduler content is auto-approved and queued (audited)', async () => {
    const { accounts } = await setup('AUTONOMOUS');
    await updateSettings((s) => ({ ...s, autonomousAuthorizedAt: new Date().toISOString() }));
    await prisma.socialAccount.update({ where: { id: accounts[0].id }, data: { autoPublishEnabled: true, autonomousAuthorized: true } });
    const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 'scheduler' });
    expect(r.queued).toBe(true);
    expect(r.advertisement.state).toBe('QUEUED');
    expect(captured.publish).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { action: 'ad.auto_approve' } })).toBe(1);
    // Manual generation by a user is never auto-published, even in autonomous mode
    const m = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 'someone@test.bh' });
    expect(m.queued).toBe(false);
  });
});

describe('job idempotency and locking', () => {
  it('creating the publication job twice returns the same job (unique idempotency key)', async () => {
    const { accounts } = await setup();
    const ad = await readyAd(accounts[0].id);
    await approveAdvertisement(ad.id, admin);
    const [a, b] = await Promise.all([createPublicationJob(ad.id, new Date(), 't'), createPublicationJob(ad.id, new Date(), 't')]);
    expect(a.id).toBe(b.id);
    expect(await prisma.publicationJob.count()).toBe(1);
  });

  it('five concurrent workers submit the job exactly once', async () => {
    const { accounts } = await setup();
    const ad = await readyAd(accounts[0].id);
    const job = await publishNow(ad.id, admin);
    adapter.submitDelayMs = 150;
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => processPublishJob(job.id, `w${i}`)));
    expect(adapter.submits).toHaveLength(1);
    expect(results.filter((r) => r === 'SCHEDULED')).toHaveLength(1);
    expect(results.filter((r) => r === 'SKIPPED_LOCKED')).toHaveLength(4);
    const j = await prisma.publicationJob.findUniqueOrThrow({ where: { id: job.id }, include: { result: true } });
    expect(j.state).toBe('SCHEDULED');
    expect(j.result?.providerPostId).toBe('post-1');
    // never scheduled in the past
    expect(adapter.submits[0].publishAt.getTime()).toBeGreaterThan(Date.now());
    // re-running the job after success does nothing
    expect(await processPublishJob(job.id, 'late')).toBe('SKIPPED_LOCKED');
  });
});

describe('verification: SCHEDULED is not PUBLISHED', () => {
  it('only provider-confirmed status marks a post PUBLISHED', async () => {
    const { accounts } = await setup();
    const ad = await readyAd(accounts[0].id);
    const job = await publishNow(ad.id, admin);
    await processPublishJob(job.id, 'w');
    adapter.status = { kind: 'PENDING', providerPostId: 'post-1', raw: {} };
    expect(await reconcileJob(job.id)).toBe('PENDING');
    expect((await prisma.advertisement.findUniqueOrThrow({ where: { id: ad.id } })).state).toBe('SCHEDULED');
    adapter.status = { kind: 'PUBLISHED', providerPostId: 'post-1', publicUrl: 'https://instagram.com/p/abc', raw: {} };
    expect(await reconcileJob(job.id)).toBe('PUBLISHED');
    const res = await prisma.publicationResult.findUniqueOrThrow({ where: { jobId: job.id } });
    expect(res.verifiedAt).not.toBeNull();
    expect(res.publicUrl).toBe('https://instagram.com/p/abc');
    expect((await prisma.advertisement.findUniqueOrThrow({ where: { id: ad.id } })).state).toBe('PUBLISHED');
  });

  it('provider-reported error after scheduling marks FAILED', async () => {
    const { accounts } = await setup();
    const job = await publishNow((await readyAd(accounts[0].id)).id, admin);
    await processPublishJob(job.id, 'w');
    adapter.status = { kind: 'ERROR', providerPostId: 'post-1', message: 'Instagram rejected media', raw: {} };
    expect(await reconcileJob(job.id)).toBe('FAILED');
    expect(await prisma.notification.count({ where: { code: 'PROVIDER_ERROR' } })).toBe(1);
  });
});

describe('failed publishing requests', () => {
  it('definitive rejection → FAILED; 401 also revokes the connection publish permission', async () => {
    const { accounts } = await setup();
    const job = await publishNow((await readyAd(accounts[0].id)).id, admin);
    adapter.outcomes.push({ kind: 'REJECTED', httpStatus: 401, message: 'token invalid' });
    expect(await processPublishJob(job.id, 'w')).toBe('FAILED');
    expect((await prisma.publicationJob.findUniqueOrThrow({ where: { id: job.id } })).state).toBe('FAILED');
    const c = await prisma.socialConnection.findUniqueOrThrow({ where: { accountId: accounts[0].id } });
    expect(c.status).toBe('INSUFFICIENT_PERMISSIONS');
    expect(c.canPublish).toBe(false);
    expect(await prisma.publicationAttempt.count({ where: { jobId: job.id, outcome: 'REJECTED' } })).toBe(1);
  });

  it('expired authorisation is detected before submitting', async () => {
    const { accounts } = await setup();
    const job = await publishNow((await readyAd(accounts[0].id)).id, admin);
    await prisma.socialConnection.update({ where: { accountId: accounts[0].id }, data: { tokenExpiresAt: new Date(Date.now() - 1000) } });
    expect(await processPublishJob(job.id, 'w')).toBe('FAILED');
    expect(adapter.submits).toHaveLength(0);
    expect((await prisma.socialConnection.findUniqueOrThrow({ where: { accountId: accounts[0].id } })).status).toBe('EXPIRED');
  });

  it('logo replaced after design was made → publication blocked', async () => {
    const { accounts, business } = await setup();
    const job = await publishNow((await readyAd(accounts[0].id)).id, admin);
    await prisma.brandAsset.updateMany({ where: { businessId: business.id }, data: { sha256: 'f'.repeat(64) } });
    expect(await processPublishJob(job.id, 'w')).toBe('FAILED');
    expect(adapter.submits).toHaveLength(0);
  });
});

describe('unknown publication states and reconciliation', () => {
  it('uncertain submit → UNKNOWN; no blind retry; reconcile finds the post → SCHEDULED', async () => {
    const { accounts } = await setup();
    const job = await publishNow((await readyAd(accounts[0].id)).id, admin);
    adapter.outcomes.push({ kind: 'UNCERTAIN', message: 'timeout' });
    expect(await processPublishJob(job.id, 'w')).toBe('UNKNOWN');
    expect(await processPublishJob(job.id, 'w2')).toBe('SKIPPED_LOCKED'); // no blind retry
    adapter.existing = { providerPostId: 'found-77' };
    expect(await reconcileJob(job.id)).toBe('FOUND');
    expect(adapter.submits).toHaveLength(1);
    const j = await prisma.publicationJob.findUniqueOrThrow({ where: { id: job.id }, include: { result: true } });
    expect(j.state).toBe('SCHEDULED');
    expect(j.result?.providerPostId).toBe('found-77');
  });

  it('absent at provider: waits for grace, then STOPS for an operator (no automatic resubmission)', async () => {
    const { accounts } = await setup();
    const job = await publishNow((await readyAd(accounts[0].id)).id, admin);
    adapter.outcomes.push({ kind: 'UNCERTAIN', message: 'ECONNRESET' });
    await processPublishJob(job.id, 'w');
    expect(await reconcileJob(job.id)).toBe('WAIT_GRACE');
    await prisma.publicationAttempt.updateMany({ data: { startedAt: new Date(Date.now() - 10 * 60_000) } });
    expect(await reconcileJob(job.id)).toBe('NEEDS_OPERATOR');
    expect(await reconcileJob(job.id)).toBe('NEEDS_OPERATOR');
    expect((await prisma.publicationJob.findUniqueOrThrow({ where: { id: job.id } })).state).toBe('UNKNOWN');
    expect(await prisma.notification.count({ where: { code: 'PUBLISH_NEEDS_OPERATOR' } })).toBe(1);
    expect(adapter.submits).toHaveLength(1);
    // operator decides: a fresh lookup runs first; proven absence → re-queued → sent once more
    expect(await resolveUnknownJob(job.id, 'resubmit', 'op@test.bh')).toBe('REQUEUED');
    expect(await processPublishJob(job.id, 'w')).toBe('SCHEDULED');
    expect(adapter.submits).toHaveLength(2);
    expect(await prisma.auditLog.count({ where: { action: 'publication.operator_resubmit' } })).toBe(1);
  });

  it('operator resubmit adopts the post if the provider has it (no duplicate); cancel closes without sending', async () => {
    const { accounts } = await setup();
    const j1 = await publishNow((await readyAd(accounts[0].id)).id, admin);
    adapter.outcomes.push({ kind: 'UNCERTAIN', message: 'timeout' });
    await processPublishJob(j1.id, 'w');
    adapter.existing = { providerPostId: 'late-1' };
    expect(await resolveUnknownJob(j1.id, 'resubmit', 'op')).toBe('FOUND');
    expect(adapter.submits).toHaveLength(1);
    adapter.existing = null;
    const j2 = await publishNow((await readyAd(accounts[1].id)).id, admin);
    adapter.outcomes.push({ kind: 'UNCERTAIN', message: 'timeout' });
    await processPublishJob(j2.id, 'w');
    expect(await resolveUnknownJob(j2.id, 'cancel', 'op')).toBe('CANCELLED');
    expect((await prisma.publicationJob.findUniqueOrThrow({ where: { id: j2.id } })).state).toBe('FAILED');
    await expect(resolveUnknownJob(j2.id, 'resubmit', 'op')).rejects.toThrow();
    expect(adapter.submits).toHaveLength(2);
  });

  it('legacy behaviour is available only when explicitly enabled', async () => {
    const { accounts } = await setup();
    await updateSettings((s) => ({ ...s, publishing: { ...s.publishing, autoResubmitAfterAbsence: true } }));
    const job = await publishNow((await readyAd(accounts[0].id)).id, admin);
    adapter.outcomes.push({ kind: 'UNCERTAIN', message: 'x' });
    await processPublishJob(job.id, 'w');
    await prisma.publicationAttempt.updateMany({ data: { startedAt: new Date(Date.now() - 10 * 60_000) } });
    expect(await reconcileJob(job.id)).toBe('REQUEUED');
  });
});

describe('V8 integrity and per-account pause', () => {
  it('approval is bound to the media SHA-256; a file modified after approval is never sent', async () => {
    const { accounts } = await setup();
    const ad = await readyAd(accounts[0].id);
    await approveAdvertisement(ad.id, admin);
    const appr = await prisma.approvalRequest.findFirstOrThrow({ where: { advertisementId: ad.id, status: 'APPROVED' } });
    const final = await prisma.mediaAsset.findFirstOrThrow({ where: { advertisementId: ad.id, role: 'FINAL' } });
    expect(appr.mediaSha256).toBe(final.sha256);
    const job = await createPublicationJob(ad.id, new Date(), 't');
    const { storage } = await import('@/lib/storage');
    await storage().put(final.storageKey, Buffer.concat([await storage().get(final.storageKey), Buffer.from('tamper')]), 'image/jpeg');
    expect(await processPublishJob(job.id, 'w')).toBe('FAILED');
    expect(adapter.submits).toHaveLength(0);
    expect((await prisma.publicationJob.findUniqueOrThrow({ where: { id: job.id } })).lastError).toMatch(/SHA-256/);
  });

  it('paused account: queued jobs are held (nothing sent), new jobs refused; resume releases them', async () => {
    const { accounts } = await setup();
    const ad = await readyAd(accounts[0].id);
    const job = await publishNow(ad.id, admin);
    await prisma.socialAccount.update({ where: { id: accounts[0].id }, data: { paused: true, pausedReason: 'test' } });
    expect(await processPublishJob(job.id, 'w')).toBe('ACCOUNT_PAUSED');
    expect(adapter.submits).toHaveLength(0);
    expect((await prisma.publicationJob.findUniqueOrThrow({ where: { id: job.id } })).state).toBe('QUEUED');
    const ad2 = await readyAd(accounts[0].id);
    await approveAdvertisement(ad2.id, admin);
    await expect(createPublicationJob(ad2.id, new Date(), 't')).rejects.toThrow(/موقوف/);
    await prisma.socialAccount.update({ where: { id: accounts[0].id }, data: { paused: false } });
    await prisma.publicationJob.update({ where: { id: job.id }, data: { nextCheckAt: null } });
    expect(await processPublishJob(job.id, 'w')).toBe('SCHEDULED');
    expect(adapter.submits).toHaveLength(1);
  });

  it('stuck submission lease → UNKNOWN (reconcile), never resent blindly', async () => {
    const { sweepStuckJobs } = await import('@/lib/ops/diagnostics');
    const { accounts } = await setup();
    const job = await publishNow((await readyAd(accounts[0].id)).id, admin);
    await prisma.publicationJob.update({ where: { id: job.id }, data: { state: 'PUBLISHING', lockedBy: 'dead', lockedAt: new Date(Date.now() - 20 * 60_000) } });
    expect(await sweepStuckJobs()).toBe(1);
    expect((await prisma.publicationJob.findUniqueOrThrow({ where: { id: job.id } })).state).toBe('UNKNOWN');
    expect(await processPublishJob(job.id, 'w')).toBe('SKIPPED_LOCKED');
    expect(adapter.submits).toHaveLength(0);
  });
});

describe('provider rate limits', () => {
  it('429 from provider puts the job back in the queue with a delay (it was not accepted)', async () => {
    const { accounts } = await setup();
    const job = await publishNow((await readyAd(accounts[0].id)).id, admin);
    captured.publish.length = 0;
    adapter.outcomes.push({ kind: 'RATE_LIMITED', retryAfterSec: 90, httpStatus: 429, message: 'slow down' });
    expect(await processPublishJob(job.id, 'w')).toBe('RATE_LIMITED');
    const j = await prisma.publicationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(j.state).toBe('QUEUED');
    expect(j.nextCheckAt!.getTime()).toBeGreaterThan(Date.now() + 80_000);
    expect(captured.publish[0].delay).toBe(90_000);
    expect(await processPublishJob(job.id, 'w')).toBe('NOT_DUE');
  });

  it('local shared limiter throttles before calling the provider', async () => {
    const { accounts } = await setup('MANUAL', 3);
    await updateSettings((s) => ({ ...s, metricool: { ...s.metricool, requestsPerMinute: 2 } }));
    const jobs = [];
    for (const a of accounts) jobs.push(await publishNow((await readyAd(a.id)).id, admin));
    const res = [];
    for (const j of jobs) res.push(await processPublishJob(j.id, 'w'));
    expect(res).toEqual(['SCHEDULED', 'SCHEDULED', 'RATE_LIMITED']);
    expect(adapter.submits).toHaveLength(2);
  });
});

describe('kill switch', () => {
  it('halts publishing immediately and blocks new publication jobs', async () => {
    const { accounts } = await setup();
    const ad1 = await readyAd(accounts[0].id);
    const job = await publishNow(ad1.id, admin);
    await updateSettings((s) => ({ ...s, killSwitch: true }));
    expect(await processPublishJob(job.id, 'w')).toBe('KILL_SWITCH');
    expect(adapter.submits).toHaveLength(0);
    expect((await prisma.publicationJob.findUniqueOrThrow({ where: { id: job.id } })).state).toBe('QUEUED');
    const ad2 = await readyAd(accounts[1].id);
    await expect(publishNow(ad2.id, admin)).rejects.toBeInstanceOf(KillSwitchError);
  });
});

describe('restart recovery', () => {
  it('jobs interrupted mid-submission become UNKNOWN (reconciled, never resubmitted blindly)', async () => {
    const { accounts } = await setup();
    const job = await publishNow((await readyAd(accounts[0].id)).id, admin);
    await prisma.publicationJob.update({ where: { id: job.id }, data: { state: 'PUBLISHING', lockedBy: 'dead-worker', lockedAt: new Date(Date.now() - 60 * 60_000) } });
    const stuckAd = await prisma.advertisement.create({ data: { accountId: accounts[1].id, productId: (await prisma.product.findFirstOrThrow()).id, format: 'IMAGE_STORY', language: 'ar', state: 'GENERATING', updatedAt: new Date(Date.now() - 3600_000) } });
    await prisma.$executeRaw`UPDATE advertisements SET "updatedAt" = now() - interval '2 hours' WHERE id = ${stuckAd.id}`;
    const r = await recoverAfterRestart();
    expect(r.unknown).toEqual([job.id]);
    expect((await prisma.publicationJob.findUniqueOrThrow({ where: { id: job.id } })).state).toBe('UNKNOWN');
    expect((await prisma.advertisement.findUniqueOrThrow({ where: { id: stuckAd.id } })).state).toBe('FAILED');
    expect(adapter.submits).toHaveLength(0);
  });
});

describe('publishing channels', () => {
  it('sends to all chosen channels linked on the brand; blocks unlinked ones before submitting', async () => {
    const { accounts } = await setup();
    await prisma.socialConnection.update({ where: { accountId: accounts[0].id }, data: { providerSnapshot: { label: 'b', networks: [{ network: 'instagram' }, { network: 'facebook' }] } } });
    const ok = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 'tester', direction: { channels: ['instagram', 'facebook'] } });
    const job = await publishNow(ok.advertisement.id, admin);
    expect(await processPublishJob(job.id, 'w')).toBe('SCHEDULED');
    expect(adapter.submits[0].networks).toEqual(['instagram', 'facebook']);
    expect(adapter.submits[0].text).toContain('33316319');
    expect(adapter.submits[0].mediaUrls[0]).toMatch(/\/api\/m\/\d+\/[^/]+\/ads\/.+\.jpg$/);
    expect(adapter.submits[0].altText).toBeTruthy();
    const bad = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 'tester', direction: { channels: ['tiktok'] } });
    const job2 = await publishNow(bad.advertisement.id, admin);
    expect(await processPublishJob(job2.id, 'w')).toBe('FAILED');
    expect(adapter.submits).toHaveLength(1);
    expect((await prisma.publicationJob.findUniqueOrThrow({ where: { id: job2.id } })).lastError).toMatch(/tiktok/);
  });
});

describe('carousel publishing', () => {
  it('generates cover + slides, binds approval to the whole bundle, publishes all images in order; a modified slide blocks publishing', async () => {
    const { accounts } = await setup();
    const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 'tester', format: 'IMAGE_CAROUSEL' });
    expect(r.advertisement.state).toBe('QUALITY_REVIEW');
    expect(r.qc?.checks.find((c) => c.id === 'carousel_slides')?.passed).toBe(true);
    const slides = await prisma.mediaAsset.findMany({ where: { advertisementId: r.advertisement.id, role: 'SLIDE' } });
    expect(slides.length).toBeGreaterThanOrEqual(4);
    const job = await publishNow(r.advertisement.id, admin);
    expect(await processPublishJob(job.id, 'w')).toBe('SCHEDULED');
    const sent = adapter.submits[0];
    expect(sent.format).toBe('IMAGE_CAROUSEL');
    expect(sent.mediaUrls).toHaveLength(slides.length + 1);
    expect(sent.mediaUrls[0]).toMatch(/final\.jpg$/); expect(sent.mediaUrls[1]).toMatch(/slide-02\.jpg$/);

    const r2 = await generateAdvertisement({ accountId: accounts[1].id, createdBy: 'tester', format: 'IMAGE_CAROUSEL' });
    await approveAdvertisement(r2.advertisement.id, admin);
    const job2 = await createPublicationJob(r2.advertisement.id, new Date(), 't');
    const s3 = await prisma.mediaAsset.findFirstOrThrow({ where: { advertisementId: r2.advertisement.id, role: 'SLIDE' } });
    const { storage } = await import('@/lib/storage');
    await storage().put(s3.storageKey, Buffer.concat([await storage().get(s3.storageKey), Buffer.from('x')]), 'image/jpeg');
    expect(await processPublishJob(job2.id, 'w')).toBe('FAILED');
    expect(adapter.submits).toHaveLength(1);
  }, 300_000);
});

describe('Google Business Profile publishing', () => {
  it('Instagram + Google: two posts (Google copy without phones/hashtags); a Google failure never fails the Instagram ad', async () => {
    const { accounts } = await setup();
    await prisma.socialConnection.update({ where: { accountId: accounts[0].id }, data: { providerSnapshot: { networks: [{ network: 'instagram' }, { network: 'gmb' }] } } });
    const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 'tester', direction: { channels: ['instagram', 'gmb'] } });
    const job = await publishNow(r.advertisement.id, admin);
    const jobs = await prisma.publicationJob.findMany({ where: { advertisementId: r.advertisement.id }, orderBy: { createdAt: 'asc' } });
    expect(jobs.map((j) => [j.networks, j.primary])).toEqual([[['instagram'], true], [['gmb'], false]]);
    expect(job.id).toBe(jobs[0].id);
    adapter.outcomes.push({ kind: 'ACCEPTED', providerPostId: 'ig-1', providerStatus: 'PENDING', raw: {}, httpStatus: 200 });
    adapter.outcomes.push({ kind: 'REJECTED', httpStatus: 400, message: 'gmb rejected' });
    expect(await processPublishJob(jobs[0].id, 'w')).toBe('SCHEDULED');
    expect(await processPublishJob(jobs[1].id, 'w')).toBe('FAILED');
    const [ig, gbp] = adapter.submits;
    expect(ig.networks).toEqual(['instagram']); expect(ig.text).toContain('33316319');
    expect(gbp.networks).toEqual(['gmb']); expect(gbp.text).not.toMatch(/\d{8}/); expect(gbp.text).not.toContain('#'); expect(gbp.mediaUrls).toHaveLength(1);
    expect((await prisma.advertisement.findUniqueOrThrow({ where: { id: r.advertisement.id } })).state).toBe('SCHEDULED'); // satellite failure did not touch the ad
  }, 300_000);
});
