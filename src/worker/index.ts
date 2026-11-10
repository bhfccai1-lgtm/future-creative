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

const workerId = `${os.hostname()}-${process.pid}`;
const log = (...a: unknown[]) => console.log(new Date().toISOString(), '[worker]', ...a);

async function main() {
  env(); // fail fast on bad configuration
  log('starting', workerId);
  log('recovery', await recoverAfterRestart());

  const sched = queue(QUEUE.scheduler);
  // Repeatable jobs (idempotent upsert): hourly cycle at minute 0 Bahrain time; reconcile every 5 minutes; nightly maintenance.
  await sched.upsertJobScheduler('hourly-cycle', { pattern: '0 * * * *', tz: TZ }, { name: 'cycle' });
  await sched.upsertJobScheduler('reconcile', { every: 5 * 60_000 }, { name: 'reconcile' });
  await sched.upsertJobScheduler('campaigns', { every: 15 * 60_000 }, { name: 'campaigns' });
  await sched.upsertJobScheduler('maintenance', { pattern: '30 3 * * *', tz: TZ }, { name: 'maintenance' });

  const workers = [
    new Worker(QUEUE.scheduler, async (job: Job) => {
      if (job.name === 'cycle') {
        // hourly: re-verify every linked account with Metricool before planning (one API call)
        const health = await getAdapter('metricool').then(verifyConnections).catch((e) => ({ error: (e as Error).message }));
        return { health, cycle: await runSchedulerCycle() };
      }
      if (job.name === 'reconcile') return reconcileSweep();
      if (job.name === 'campaigns') return runCampaignCycle();
      if (job.name === 'maintenance') return { retention: await applyRetention(), perf: await refreshPerformanceScores() };
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
