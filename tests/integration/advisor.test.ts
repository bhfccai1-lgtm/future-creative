import { beforeEach, describe, expect, it, vi } from 'vitest';

// the advisor reads the REAL disk; tests must not depend on the free space of the machine running them
vi.mock('node:fs/promises', async (orig) => ({ ...(await orig<typeof import('node:fs/promises')>()), statfs: async () => ({ bavail: 60_000_000, blocks: 100_000_000, bsize: 4096 }) }));
import { prisma } from '@/lib/db';
import { updateSettings } from '@/lib/settings';
import { runAdvisor, recordHealthSnapshot, healthHistory, QC_FIX } from '@/lib/ops/advisor';
import { HEARTBEAT_KEY } from '@/lib/ops/diagnostics';
import { redis } from '@/lib/queue/connection';
import { generateAdvertisement } from '@/lib/pipeline/generate';
import { setAiProviderOverride } from '@/lib/ai';
import { captureQueues, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); await redis().set(HEARTBEAT_KEY, String(Date.now())); });

describe('professional advisor', () => {
  it('worker down is critical and drives the score down', async () => {
    await seedBase();
    await redis().del(HEARTBEAT_KEY);
    const r = await runAdvisor();
    const a = r.advice.find((x) => x.id === 'worker_down')!;
    expect(a).toMatchObject({ severity: 'critical', category: 'reliability' });
    expect(a.steps.join(' ')).toMatch(/docker compose/);
    expect(r.score).toBeLessThanOrEqual(75);
    expect(r.advice[0].severity).toBe('critical'); // sorted by priority
  });
  it('detects stalled publishing, UNKNOWN jobs and story-only accounts with evidence', async () => {
    const { accounts } = await seedBase();
    await updateSettings((s) => ({ ...s, autoPublishGlobal: true }));
    await prisma.socialAccount.updateMany({ data: { autoPublishEnabled: true } });
    const r = await runAdvisor();
    expect(r.advice.find((x) => x.id === 'publishing_stalled')?.evidence).toMatch(/لم تُنشأ أبدًا/);
    expect(r.advice.find((x) => x.id === 'story_only')?.evidence).toContain(accounts[0].name);
    expect(r.advice.find((x) => x.id === 'unknown_jobs')).toBeUndefined();
  });
  it('flags posting overload (too many posts in one day on one account) with the daily-limit and gap fix', async () => {
    const { accounts } = await seedBase();
    const [busy, calm] = accounts;
    const product = await prisma.product.findFirstOrThrow();
    const day = new Date('2026-11-18T06:00:00Z'); // 09:00 in Bahrain
    const job = async (accountId: string, i: number) => {
      const ad = await prisma.advertisement.create({ data: { accountId, productId: product.id, format: 'REEL_VIDEO', language: 'ar', state: 'PUBLISHED', createdBy: 't' } });
      await prisma.publicationJob.create({ data: { idempotencyKey: `ov-${accountId}-${i}`, advertisementId: ad.id, accountId, provider: 'metricool', state: 'PUBLISHED', scheduledFor: new Date(day.getTime() + i * 3600_000) } });
    };
    for (let i = 0; i < 5; i++) await job(busy.id, i); // 5 posts the same day → overload
    for (let i = 0; i < 3; i++) await job(calm.id, i); // 3 = within the limit
    const r = await runAdvisor(new Date('2026-11-19T09:00:00Z'));
    const a = r.advice.find((x) => x.id === 'posting_overload')!;
    expect(a.evidence).toContain(`${busy.name}: 5 منشورات يوم 2026-11-18`);
    expect(a.evidence).not.toContain(calm.name);
    expect(a.steps.join(' ')).toMatch(/180/); // the default 30-minute gap → a longer one is suggested
    expect(a.link).toBe(`/accounts/${busy.id}`);
  });
  it('dry-run designs are reported as unpublishable, with the fix', async () => {
    const { accounts } = await seedBase();
    await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't' });
    const a = (await runAdvisor()).advice.find((x) => x.id === 'dry_run')!;
    expect(a.severity).toBe('high'); expect(a.link).toBe('/settings/ai');
  });
  it('KPIs come from real rows (no invented numbers) and the budget projection warns early', async () => {
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false, monthlyBudgetUsd: 1 } }) });
    setAiProviderOverride(new FakeAiProvider());
    await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't' });
    // above the $1 budget: the projection (spend ÷ day × days in month) exceeds it on ANY day — with $0.90 the test
    // passed early in the month and failed from about the 27th (0.9 × 30/28 < 1)
    await prisma.aiUsage.create({ data: { provider: 'x', model: 'x', kind: 'image', costUsd: '1.2' } });
    const r = await runAdvisor();
    expect(r.kpis.designs7d).toBe(1);
    expect(r.kpis.publishSuccessRate).toBeNull(); // no publications yet → unknown, not 0 or 100
    expect(r.kpis.avgEngagement30d).toBeNull();
    expect(r.advice.find((x) => x.id === 'budget_projection')).toBeDefined();
  });
  it('recurring QC failures map to concrete fixes', async () => {
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
    setAiProviderOverride(new FakeAiProvider());
    for (let i = 0; i < 3; i++) {
      const ad = (await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't' })).advertisement;
      const qc = (await prisma.advertisement.findUniqueOrThrow({ where: { id: ad.id } })).qcReport as { checks: { id: string; passed: boolean }[] };
      qc.checks.push({ id: 'claims', label: 'claims', passed: false, severity: 'BLOCKER' } as never);
      await prisma.advertisement.update({ where: { id: ad.id }, data: { qcReport: qc as never } });
    }
    const a = (await runAdvisor()).advice.find((x) => x.id === 'qc_claims')!;
    expect(a.title).toBe(QC_FIX.claims.title); expect(a.evidence).toMatch(/3 من 3/);
  });
  it('a healthy fresh system scores high; daily snapshots build a trend', async () => {
    await seedBase();
    const r = await runAdvisor();
    expect(r.counts.critical).toBe(0);
    expect(r.score).toBeGreaterThanOrEqual(75);
    await recordHealthSnapshot(new Date('2026-11-10T04:00:00Z'));
    await recordHealthSnapshot(new Date('2026-11-11T04:00:00Z'));
    await recordHealthSnapshot(new Date('2026-11-11T05:00:00Z')); // same day → replaced, not duplicated
    expect((await healthHistory()).map((h) => h.date)).toEqual(['2026-11-10', '2026-11-11']);
  });
});
