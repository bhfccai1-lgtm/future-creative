import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { runAnalysis, supportReport } from '@/lib/ops/analysis';
import { captureQueues, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });

const NOW = new Date('2026-11-25T12:00:00Z'), H = 3600_000, D = 24 * H;

async function seedWeeks() {
  const { accounts } = await seedBase();
  const product = await prisma.product.findFirstOrThrow();
  let k = 0;
  const job = async (at: Date, ok: boolean, err?: string) => {
    const ad = await prisma.advertisement.create({ data: { accountId: accounts[0].id, productId: product.id, format: 'IMAGE_FEED', language: 'ar', state: ok ? 'PUBLISHED' : 'FAILED', createdBy: 't', qcPassed: true, createdAt: at } });
    await prisma.publicationJob.create({ data: { idempotencyKey: `an-${k++}`, advertisementId: ad.id, accountId: accounts[0].id, provider: 'metricool', state: ok ? 'PUBLISHED' : 'FAILED', scheduledFor: at, lastError: err ?? null,
      ...(ok ? { result: { create: { verifiedAt: new Date(at.getTime() + 4 * 60_000), engagementScore: 5 } } } : {}) } });
  };
  // previous week: 28 of 30 published (93 %)
  for (let i = 0; i < 30; i++) await job(new Date(NOW.getTime() - 8 * D - i * 3 * H), i >= 2, i < 2 ? 'timeout' : undefined);
  // this week: 15 of 30 (50 %) — the same Metricool failure with different ids
  for (let i = 0; i < 30; i++) await job(new Date(NOW.getTime() - D - i * 3 * H), i >= 15, i < 15 ? `Metricool 502 for post c${String(i).padStart(24, 'x')}` : undefined);
}

describe('expert analysis on the diagnostics page', () => {
  it('a real drop in publishing is detected (significance), traced to its root cause (Pareto) and turned into advice', async () => {
    await seedWeeks();
    const a = await runAnalysis(NOW);
    const t = a.trends.find((x) => x.id === 'publish_ok')!;
    expect([t.previous, t.current, t.verdict]).toEqual([93.3, 50, 'worsened']);
    expect(t.z!).toBeLessThan(-1.96);
    expect(a.trends.find((x) => x.id === 'designs')!.verdict).toBe('stable'); // 30 vs 30
    expect(a.causes[0]).toMatchObject({ source: 'النشر', count: 15, share: 100 }); // 15 messages, one signature
    expect(a.causes[0].key).toMatch(/^Metricool # for post <id>$/);
    const adv = a.advice.find((x) => x.id === 'trend_publish_ok')!;
    expect(adv.severity).toBe('high');
    expect(adv.steps[0]).toContain('Metricool');
    const delay = a.slos.find((s) => s.id === 'publish_delay')!;
    expect(delay).toMatchObject({ n: 15, p50: 4, p90: 4, ok: true });
    expect(a.runtime.migrations?.pending).toEqual([]); // the test database is fully migrated
    expect(a.runtime.queues?.map((q) => q.name)).toEqual(['fc-scheduler', 'fc-generate', 'fc-publish']);
    const txt = supportReport(a, { version: 'abc1234', overall: 'OK', score: 90, failedChecks: [] });
    expect(txt).toContain('نجاح النشر المؤكد: 93.3 → 50 ↓ تراجع');
    expect(txt).not.toMatch(/postgres(ql)?:\/\/|password|sk-/i); // no connection strings or keys in the support report
  });

  it('on-time publishing: real lateness (Instagram time) and our confirmation speed are measured separately', async () => {
    const { accounts } = await seedBase();
    const product = await prisma.product.findFirstOrThrow();
    for (let i = 0; i < 12; i++) {
      const at = new Date(NOW.getTime() - D - i * 3 * H);
      const ad = await prisma.advertisement.create({ data: { accountId: accounts[0].id, productId: product.id, format: 'IMAGE_FEED', language: 'ar', state: 'PUBLISHED', createdBy: 't', qcPassed: true, createdAt: at } });
      // Instagram shows the post 3 min after the slot; the old 5-minute polling confirmed it ~17 min after the slot
      await prisma.publicationJob.create({ data: { idempotencyKey: `ot-${i}`, advertisementId: ad.id, accountId: accounts[0].id, provider: 'metricool', state: 'PUBLISHED', scheduledFor: at,
        result: { create: { publishedAt: new Date(at.getTime() + 3 * 60_000), verifiedAt: new Date(at.getTime() + 17 * 60_000) } } } });
    }
    const a = await runAnalysis(NOW);
    const real = a.slos.find((s) => s.id === 'publish_delay')!, lag = a.slos.find((s) => s.id === 'confirm_lag')!;
    expect(real).toMatchObject({ label: 'تأخر النشر الفعلي (توقيت إنستغرام)', p90: 3, target: 10, ok: true }); // publishing itself is on time
    expect(lag).toMatchObject({ n: 12, p90: 14, ok: false }); // the delay was our confirmation, not Instagram
    expect(a.advice.find((x) => x.id === 'slo_confirm_lag')!.why).toContain('النشر نفسه في موعده');
    expect(a.advice.find((x) => x.id === 'slo_publish_delay')).toBeUndefined();
  });

  it('a database update that failed half-way is critical advice (the likely cause of «internal server error»)', async () => {
    await seedBase();
    await prisma.$executeRawUnsafe(`INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, applied_steps_count) VALUES ('test-failed', 'x', '20991231000000_broken', now(), 0)`);
    try {
      const a = await runAnalysis(NOW);
      expect(a.runtime.migrations?.failed).toEqual(['20991231000000_broken']);
      const m = a.advice.find((x) => x.id === 'migrations')!;
      expect(m.severity).toBe('critical');
      expect(m.steps.join(' ')).toContain('bash scripts/update.sh');
    } finally {
      await prisma.$executeRawUnsafe(`DELETE FROM "_prisma_migrations" WHERE id = 'test-failed'`);
    }
  });
});
