import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { fixFor, runFix, safeFixesFor } from '@/lib/ops/fixes';
import { getSettings } from '@/lib/settings';
import { captureQueues, resetDb, seedBase } from './helpers';

const admin = { sub: '', email: 'admin@test.bh' };
beforeEach(async () => { await resetDb(); captureQueues(); });
const seed = async () => { const r = await seedBase(); admin.sub = (await prisma.user.findFirstOrThrow({ where: { email: 'admin@test.bh' } })).id; return r; };

describe('«إصلاح الآن» — diagnostics fixes the safe problems itself', () => {
  it('maps findings to fixes; «fix all» takes only the safe ones; human decisions have no automatic fix', () => {
    expect(fixFor('stuck')?.id).toBe('stuck_jobs');
    expect(fixFor('connections_broken')?.id).toBe('metricool_verify');
    // low disk is NOT offered the retention clean-up: it deletes old rows, not the backups/images that fill the disk
    expect(fixFor('disk_low')).toBeNull();
    for (const human of ['unknown_jobs', 'approval_backlog', 'kill_switch', 'dry_run', 'worker_down']) expect(fixFor(human), human).toBeNull();
    expect(fixFor('n8n_dead_retry')).toMatchObject({ id: 'n8n_retry', safe: false }); // resend → confirmation
    expect(fixFor('drive_archive_retry')).toMatchObject({ id: 'drive_retry', safe: true }); // the archive answers «duplicate»
    expect(safeFixesFor(['stuck', 'metricool_check', 'connections_broken', 'disk_low', 'unknown_jobs', 'n8n_dead_retry', 'shop_board'])).toEqual(['stuck_jobs', 'metricool_verify', 'print_reminder']);
  });

  it('stuck publishing jobs are released to «UNKNOWN» for reconciliation (never resent), audited', async () => {
    const { accounts } = await seed();
    const product = await prisma.product.findFirstOrThrow();
    const ad = await prisma.advertisement.create({ data: { accountId: accounts[0].id, productId: product.id, format: 'IMAGE_FEED', language: 'ar', state: 'PUBLISHING', createdBy: 't' } });
    const job = await prisma.publicationJob.create({ data: { idempotencyKey: 'stuck-1', advertisementId: ad.id, accountId: accounts[0].id, provider: 'metricool', state: 'PUBLISHING', scheduledFor: new Date(), lockedBy: 'w', lockedAt: new Date(Date.now() - 60 * 60_000) } });
    const r = await runFix('stuck_jobs', admin);
    expect(r).toMatchObject({ ok: true });
    expect(r.message).toMatch(/1 مهمة عالقة/);
    expect((await prisma.publicationJob.findUniqueOrThrow({ where: { id: job.id } })).state).toBe('UNKNOWN');
    expect(await prisma.auditLog.count({ where: { action: 'diagnostics.fix', targetId: 'stuck_jobs' } })).toBe(1);
    expect((await runFix('stuck_jobs', admin)).message).toMatch(/لا توجد مهام عالقة/); // idempotent
  });

  it('retention frees old operational data only; Metricool re-check records its result; an unknown fix is refused', async () => {
    await seed();
    const old = new Date(Date.now() - 200 * 86400_000);
    await prisma.notification.create({ data: { level: 'INFO', code: 'X', title: 'قديم', message: 'm', readAt: old, createdAt: old } });
    await prisma.notification.create({ data: { level: 'INFO', code: 'Y', title: 'جديد', message: 'm' } });
    expect((await runFix('retention', admin)).message).toMatch(/حُذف 1 إشعار/);
    expect(await prisma.notification.count()).toBe(1);

    const m = await runFix('metricool_verify', admin); // no token in tests → still failing, with the next step
    expect(m.ok).toBe(false);
    expect((await getSettings()).metricool.lastCheckAt).toBeTruthy();

    expect((await runFix('queue_clean', admin)).ok).toBe(true);
    await expect(runFix('drop_database', admin)).rejects.toMatchObject({ code: 'UNKNOWN_FIX' });
  });
});
