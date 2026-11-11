/**
 * Background worker process: hourly scheduler, generation, publishing, reconciliation.
 * Run with: npm run worker   (in Docker: the `worker` service)
 */
import { Worker, type Job } from 'bullmq';
import os from 'node:os';
import { newRedisConnection } from '../lib/queue/connection';
import { QUEUE, queue, type GenerateJobData, type PublishJobData } from '../lib/queue/queues';
import { runSchedulerCycle } from '../lib/scheduler/cycle';
import { generateAdvertisement } from '../lib/pipeline/generate';
import { processPublishJob } from '../lib/publishing/publisher';
import { reconcileSweep } from '../lib/publishing/reconcile';
import { recoverAfterRestart, applyRetention } from '../lib/ops/recovery';
import { refreshPerformanceScores } from '../lib/creative/selector';
import { runCampaignCycle } from '../lib/campaigns/cycle';
import { verifyConnections } from '../lib/publishing/health';
import { getAdapter } from '../lib/publishing/registry';
import { prisma } from '../lib/db';
import { notify } from '../lib/audit';
import { env } from '../lib/env';
import { TZ } from '../lib/time';
import type { MediaFormat } from '@prisma/client';
import { importMetrics } from '../lib/analytics/import';
import { deliverPending, emitEvent } from '../lib/integrations/events';
import { emitDailyDigest, runApprovalReminders } from '../lib/integrations/digest';
import { buildReport } from '../lib/analytics/report';
import { sweepStuckJobs, HEARTBEAT_KEY } from '../lib/ops/diagnostics';
import { redis } from '../lib/queue/connection';

const workerId = `${os.hostname()}-${process.pid}`;
const log = (...a: unknown[]) => console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', event: 'worker', msg: a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ').slice(0, 1000) }));

async function main() {
  env(); // fail fast on bad configuration
  log('starting', workerId);
  log('recovery', await recoverAfterRestart());

  // liveness heartbeat for diagnostics (/api/diagnostics, /ig-health)
  const beat = () => redis().set(HEARTBEAT_KEY, String(Date.now()), 'EX', 600).catch(() => undefined);
  await beat(); setInterval(beat, 60_000).unref();

  const sched = queue(QUEUE.scheduler);
  // Repeatable jobs (idempotent upsert): hourly cycle at minute 0 Bahrain time; reconcile every 5 minutes; nightly maintenance.
  await sched.upsertJobScheduler('hourly-cycle', { pattern: '0 * * * *', tz: TZ }, { name: 'cycle' });
  await sched.upsertJobScheduler('reconcile', { every: 5 * 60_000 }, { name: 'reconcile' });
  await sched.upsertJobScheduler('campaigns', { every: 15 * 60_000 }, { name: 'campaigns' });
  await sched.upsertJobScheduler('maintenance', { pattern: '30 3 * * *', tz: TZ }, { name: 'maintenance' });
  await sched.upsertJobScheduler('webhooks', { every: 60_000 }, { name: 'webhooks' }); // n8n outbox delivery
  await sched.upsertJobScheduler('approval-reminders', { pattern: '20 * * * *', tz: TZ }, { name: 'approval-reminders' });
  await sched.upsertJobScheduler('daily-digest', { pattern: '5 21 * * *', tz: TZ }, { name: 'daily-digest' }); // 21:05 Bahrain
  await sched.upsertJobScheduler('weekly-report', { pattern: '40 8 * * 0', tz: TZ }, { name: 'weekly-report' }); // Sunday 08:40 Bahrain
  await sched.upsertJobScheduler('analytics', { pattern: '15 5,17 * * *', tz: TZ }, { name: 'analytics' }); // read-only metrics import twice a day

  const workers = [
    new Worker(QUEUE.scheduler, async (job: Job) => {
      if (job.name === 'cycle') {
        // hourly: re-verify every linked account with Metricool before planning (one API call)
        const health = await getAdapter('metricool').then(verifyConnections).catch((e) => ({ error: (e as Error).message }));
        return { health, cycle: await runSchedulerCycle() };
      }
      if (job.name === 'reconcile') return { stuck: await sweepStuckJobs(), ...(await reconcileSweep()) };
      if (job.name === 'analytics') return importMetrics(await getAdapter('metricool'));
      if (job.name === 'webhooks') return deliverPending();
      if (job.name === 'approval-reminders') return runApprovalReminders();
      if (job.name === 'daily-digest') return emitDailyDigest();
      if (job.name === 'weekly-report') {
        const r = await buildReport('week');
        await emitEvent('report.weekly', { period: 'week', from: r.from, to: r.to, publishing: r.publishing, metrics: r.metrics, top: r.top, failures: r.failures.slice(0, 5), recommendations: r.recommendations, reportUrl: '/reports' });
        return { emitted: true };
      }
      if (job.name === 'campaigns') return runCampaignCycle();
      if (job.name === 'maintenance') return { retention: await applyRetention(), perf: await refreshPerformanceScores() };
      return undefined;
    }, { connection: newRedisConnection(), concurrency: 1 }),
    new Worker(QUEUE.generate, async (job: Job<GenerateJobData>) => {
      try {
        const r = await generateAdvertisement({ ...job.data, format: job.data.format as MediaFormat | undefined });
        if (job.data.scheduleId) await prisma.publicationSchedule.update({ where: { id: job.data.scheduleId }, data: { status: r.advertisement.state === 'FAILED' ? 'FAILED' : 'READY' } });
        return { adId: r.advertisement.id, state: r.advertisement.state, queued: r.queued };
      } catch (e) {
        // Pre-generation guards (logo missing, budget, daily limits) throw before an ad exists.
        const msg = (e as Error).message;
        if (job.data.scheduleId) await prisma.publicationSchedule.update({ where: { id: job.data.scheduleId }, data: { status: 'FAILED', reason: msg.slice(0, 500) } });
        await notify('ERROR', `GEN_BLOCKED_${(e as { code?: string }).code ?? 'ERROR'}`, 'تعذر بدء توليد إعلان', msg, job.data.accountId);
        throw e;
      }
    }, { connection: newRedisConnection(), concurrency: env().WORKER_CONCURRENCY }),
    new Worker(QUEUE.publish, async (job: Job<PublishJobData>) => processPublishJob(job.data.publicationJobId, workerId),
      { connection: newRedisConnection(), concurrency: 1 }),
  ];
  for (const w of workers) {
    w.on('failed', (j, e) => log('job failed', w.name, j?.id, e.message));
    w.on('completed', (j, r) => log('job done', w.name, j.name, j.id, JSON.stringify(r)?.slice(0, 300)));
  }
  const shutdown = async () => { log('shutting down'); await Promise.all(workers.map((w) => w.close())); await prisma.$disconnect(); process.exit(0); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}

main().catch((e) => { console.error(e); process.exit(1); });
