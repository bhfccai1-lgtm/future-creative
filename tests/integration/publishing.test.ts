import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { generateAdvertisement } from '@/lib/pipeline/generate';
import { setAiProviderOverride } from '@/lib/ai';
import { setPublishingAdapterOverride } from '@/lib/publishing/registry';
import { approveAdvertisement, createPublicationJob, publishNow, rejectAdvertisement } from '@/lib/publishing/jobs';
import { processPublishJob } from '@/lib/publishing/publisher';
import { reconcileJob } from '@/lib/publishing/reconcile';
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

  it('absent at provider: waits for the grace period, then re-queues (bounded)', async () => {
    const { accounts } = await setup();
    const job = await publishNow((await readyAd(accounts[0].id)).id, admin);
    adapter.outcomes.push({ kind: 'UNCERTAIN', message: 'ECONNRESET' });
    await processPublishJob(job.id, 'w');
    expect(await reconcileJob(job.id)).toBe('WAIT_GRACE');
    await prisma.publicationAttempt.updateMany({ data: { startedAt: new Date(Date.now() - 10 * 60_000) } });
    expect(await reconcileJob(job.id)).toBe('REQUEUED');
    expect((await prisma.publicationJob.findUniqueOrThrow({ where: { id: job.id } })).state).toBe('QUEUED');
    expect(await processPublishJob(job.id, 'w')).toBe('SCHEDULED');
    expect(adapter.submits).toHaveLength(2);
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
