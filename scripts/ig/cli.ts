/**
 * Operator CLI used by the Claude Code skills (/ig-health, /ig-report, /ig-recover, …).
 * Read-only by default. Commands that change state require an explicit --confirm flag, and NOTHING here
 * submits a post to a provider directly — publishing always goes through the worker's guarded pipeline.
 *
 *   npx tsx scripts/ig/cli.ts health
 *   npx tsx scripts/ig/cli.ts accounts
 *   npx tsx scripts/ig/cli.ts report week|month [accountId]
 *   npx tsx scripts/ig/cli.ts experiments [accountId]
 *   npx tsx scripts/ig/cli.ts preflight <adId>
 *   npx tsx scripts/ig/cli.ts recover list
 *   npx tsx scripts/ig/cli.ts recover resubmit|cancel <jobId> --confirm
 *   npx tsx scripts/ig/cli.ts generate <accountId> [IMAGE_STORY|IMAGE_FEED|IMAGE_SQUARE|REEL_VIDEO] [idea…] --confirm
 *   npx tsx scripts/ig/cli.ts probe <adId>
 *   npx tsx scripts/ig/cli.ts pause|resume <accountId> [reason] --confirm
 *
 * On the server run inside the worker container:  docker compose exec worker npx tsx scripts/ig/cli.ts health
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prisma } from '../../src/lib/db';
import { closeRedis } from '../../src/lib/queue/connection';
import { closeQueues, enq } from '../../src/lib/queue/queues';
import { runDiagnostics, sweepStuckJobs } from '../../src/lib/ops/diagnostics';
import { buildReport } from '../../src/lib/analytics/report';
import { analyse, loadSamples, labelOf } from '../../src/lib/analytics/insights';
import { resolveUnknownJob } from '../../src/lib/publishing/reconcile';
import { qcVerdict, type QcReport } from '../../src/lib/qc';
import { loadApprovedLogo } from '../../src/lib/brand/logo';
import { storage } from '../../src/lib/storage';
import { sha256 } from '../../src/lib/crypto';
import { bundleSha, publishableMedia } from '../../src/lib/publishing/media';
import { getSettings } from '../../src/lib/settings';
import { probeVideo, REEL_REQUIREMENTS } from '../../src/lib/video/probe';
import { audit } from '../../src/lib/audit';
import { fmtLocal } from '../../src/lib/time';
import type { MediaFormat } from '@prisma/client';

const args = process.argv.slice(2).filter((a) => a !== '--confirm');
const confirmed = process.argv.includes('--confirm');
const out = (x: unknown) => console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2));
const need = (v: string | undefined, what: string) => { if (!v) throw new Error(`missing ${what}`); return v; };
const requireConfirm = (what: string) => { if (!confirmed) throw new Error(`${what} changes state — re-run with --confirm after the operator agrees.`); };

async function preflight(adId: string) {
  const s = await getSettings();
  const ad = await prisma.advertisement.findUniqueOrThrow({ where: { id: adId }, include: { media: true, account: { include: { connection: true } }, approvals: { where: { status: 'APPROVED' }, orderBy: { decidedAt: 'desc' }, take: 1 } } });
  const checks: { check: string; ok: boolean; detail?: string }[] = [];
  const add = (check: string, ok: boolean, detail?: string) => checks.push({ check, ok, detail });
  const qc = ad.qcReport as unknown as QcReport | null;
  add('kill switch off', !s.killSwitch, s.killSwitchReason ?? undefined);
  add('account not paused', !ad.account.paused, ad.account.pausedReason ?? undefined);
  add('real AI output (not dry-run)', !ad.dryRun);
  add('QC publishable', !!qc?.publishable, `verdict ${qcVerdict(qc)}`);
  add('state approvable/approved', ['QUALITY_REVIEW', 'APPROVED', 'QUEUED'].includes(ad.state), ad.state);
  try { const logo = await loadApprovedLogo(ad.account.businessId); add('logo fingerprint unchanged', logo.sha256 === ad.logoSha256); } catch (e) { add('logo fingerprint unchanged', false, (e as Error).message); }
  const list = publishableMedia(ad);
  const missing = [];
  for (const m of list) if (!(await storage().exists(m.storageKey))) missing.push(m.storageKey);
  if (!list.length || missing.length) add('final media present', false, `${list.length} files, missing ${missing.length}`);
  else {
    const shas = await Promise.all(list.map(async (m) => sha256(await storage().get(m.storageKey))));
    add(`media SHA-256 matches render (${list.length} file${list.length > 1 ? 's' : ''})`, shas.every((h, i) => h === list[i].sha256));
    const appr = ad.approvals[0];
    if (appr) add('media matches approved bytes', !appr.mediaSha256 || appr.mediaSha256 === bundleSha(shas));
  }
  const c = ad.account.connection;
  add('connection verified with publish permission', !!c && c.status === 'CONNECTED' && c.canPublish && !!c.providerBrandId, c?.status);
  const ok = checks.every((x) => x.ok);
  return { adId, account: ad.account.name, verdict: ok ? 'READY (nothing was sent)' : 'BLOCKED', checks };
}

async function main() {
  const [cmd, a1, a2, ...rest] = args;
  switch (cmd) {
    case 'health': {
      const d = await runDiagnostics();
      out(`overall: ${d.overall}  (${fmtLocal(new Date(d.at))} Asia/Bahrain)`);
      for (const c of d.checks) out(`${c.status.padEnd(4)}  ${c.label} — ${c.detail}${c.action ? `  → ${c.action}` : ''}${c.command ? `  $ ${c.command}` : ''}`);
      process.exitCode = d.overall === 'FAIL' ? 1 : 0; return;
    }
    case 'accounts': {
      const rows = await prisma.socialAccount.findMany({ include: { connection: true, _count: { select: { advertisements: true } } }, orderBy: { name: 'asc' } });
      out(rows.map((a) => ({ id: a.id, name: a.name, lang: a.language, format: a.publishFormat, everyHours: a.publishIntervalMinutes / 60, connection: a.connection?.status ?? 'NONE', canPublish: !!a.connection?.canPublish, brandId: a.connection?.providerBrandId ?? null, autoPublish: a.autoPublishEnabled, autonomous: a.autonomousAuthorized, paused: a.paused, next: fmtLocal(a.nextPublishAt), ads: a._count.advertisements })));
      return;
    }
    case 'report': out(await buildReport(a1 === 'month' ? 'month' : 'week', a2)); return;
    case 'experiments': {
      const r = analyse(await loadSamples({ accountId: a1, since: new Date(Date.now() - 90 * 86400_000) }));
      out({ samples: r.total, smallSample: r.smallSample, overallEngagementPct: r.overall, insights: r.insights.map((i) => ({ dimension: i.dimensionAr, best: labelOf(i.dimension, i.best.value), liftPct: Math.round(i.liftPct), n: `${i.best.n} vs ${i.rest.n}`, p: i.p, confidence: i.confidence, experiment: i.experiment ? { A: labelOf(i.dimension, i.experiment.a), B: labelOf(i.dimension, i.experiment.b), postsPerVariant: i.experiment.perVariant } : null })) });
      return;
    }
    case 'preflight': out(await preflight(need(a1, 'adId'))); return;
    case 'recover': {
      if (a1 === 'list') {
        const stuck = await prisma.publicationJob.count({ where: { state: 'PUBLISHING', lockedAt: { lt: new Date(Date.now() - 15 * 60_000) } } });
        const jobs = await prisma.publicationJob.findMany({ where: { state: { in: ['UNKNOWN', 'FAILED'] }, updatedAt: { gte: new Date(Date.now() - 7 * 86400_000) } }, include: { account: { select: { name: true } }, attempts: { orderBy: { attemptNo: 'desc' }, take: 1 } }, orderBy: { updatedAt: 'desc' }, take: 50 });
        out({ stuckPublishing: stuck, jobs: jobs.map((j) => ({ id: j.id, state: j.state, account: j.account.name, scheduledFor: fmtLocal(j.scheduledFor), attempts: j.attemptCount, lastOutcome: j.attempts[0]?.outcome ?? null, error: j.lastError })) });
        return;
      }
      if (a1 === 'sweep') { requireConfirm('sweep'); out({ movedToUnknown: await sweepStuckJobs() }); return; }
      if (a1 === 'resubmit' || a1 === 'cancel') { requireConfirm(a1); out({ result: await resolveUnknownJob(need(a2, 'jobId'), a1, 'claude-code-cli') }); return; }
      throw new Error('recover list | sweep | resubmit <jobId> | cancel <jobId>');
    }
    case 'generate': {
      requireConfirm('generate');
      const accountId = need(a1, 'accountId');
      await prisma.socialAccount.findUniqueOrThrow({ where: { id: accountId } });
      const format = (['IMAGE_STORY', 'IMAGE_FEED', 'IMAGE_SQUARE', 'REEL_VIDEO'].includes(a2 ?? '') ? a2 : undefined) as MediaFormat | undefined;
      const idea = rest.join(' ').trim();
      const jobId = `cli-${randomUUID()}`;
      await enq.generate({ accountId, format, direction: idea ? { idea: idea.slice(0, 500) } : undefined, createdBy: 'claude-code-cli' }, jobId);
      await audit({ actorLabel: 'claude-code-cli', action: 'ad.generate.request', targetType: 'social_account', targetId: accountId, details: { format: format ?? null, idea } });
      out({ queued: jobId, note: 'Generation runs in the worker; the design lands in the approval queue (no publishing).' });
      return;
    }
    case 'probe': {
      const ad = await prisma.advertisement.findUniqueOrThrow({ where: { id: need(a1, 'adId') }, include: { media: true } });
      const v = ad.media.find((m) => m.role === 'VIDEO');
      if (!v) { out({ adId: ad.id, video: null, note: 'This ad has no MP4 — it is a still image, not a Reel.' }); return; }
      const tmp = path.join(os.tmpdir(), `probe-${ad.id}.mp4`);
      await fs.writeFile(tmp, await storage().get(v.storageKey));
      try { out({ adId: ad.id, sha256Matches: sha256(await fs.readFile(tmp)) === v.sha256, probe: await probeVideo(tmp, REEL_REQUIREMENTS) }); }
      finally { await fs.rm(tmp, { force: true }); }
      return;
    }
    case 'pause': case 'resume': {
      requireConfirm(cmd);
      const id = need(a1, 'accountId'); const paused = cmd === 'pause'; const reason = [a2, ...rest].filter(Boolean).join(' ') || null;
      await prisma.socialAccount.update({ where: { id }, data: { paused, pausedReason: paused ? reason : null, pausedAt: paused ? new Date() : null } });
      await audit({ actorLabel: 'claude-code-cli', action: paused ? 'account.pause' : 'account.resume', targetType: 'social_account', targetId: id, details: { reason } });
      out({ id, paused }); return;
    }
    default:
      out('commands: health | accounts | report week|month [accountId] | experiments [accountId] | preflight <adId> | recover list|sweep|resubmit|cancel | generate <accountId> [format] [idea] | probe <adId> | pause|resume <accountId>');
  }
}

main().catch((e) => { console.error(`error: ${(e as Error).message}`); process.exitCode = 1; })
  .finally(async () => { await closeQueues().catch(() => undefined); await closeRedis(); await prisma.$disconnect(); });
