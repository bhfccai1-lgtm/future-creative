import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { setPublishingAdapterOverride } from '@/lib/publishing/registry';
import { scanForeignPosts } from '@/lib/ops/foreign-posts';
import { runAdvisor } from '@/lib/ops/advisor';
import { updateSettings } from '@/lib/settings';
import { env } from '@/lib/env';
import { captureQueues, FakeAdapter, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });
const at = (h: number) => new Date(Date.now() + h * 3600_000);

describe('posts made outside the system', () => {
  it('flags only foreign posts, with concrete risks, and notifies once', async () => {
    const { accounts } = await seedBase({ accounts: 1 });
    await prisma.socialAccount.update({ where: { id: accounts[0].id }, data: { publishWindowStart: '09:00', publishWindowEnd: '22:00' } });
    const base = env().PUBLIC_BASE_URL.replace(/\/$/, '');
    const nightBh = new Date(new Date().toISOString().slice(0, 10) + 'T22:00:00Z'); // 01:00 Bahrain next day
    const fake = Object.assign(new FakeAdapter(), {
      listScheduled: async () => [
        { id: 'ours', at: at(2), text: 'x', media: [`${base}/api/m/1/s/ads/a/final.jpg`], type: 'STORY', status: 'PENDING' },
        { id: 'ext1', at: nightBh, text: 'طباعة بسرعة خصم 50% اليوم', media: ['https://static.metricool.com/planner/x.jpg'], type: 'REEL', status: 'PENDING' },
        { id: 'ext2', at: at(3), text: '', media: ['https://static.metricool.com/planner/y.jpg'], type: 'STORY', status: 'PUBLISHED' },
      ],
    });
    setPublishingAdapterOverride(fake);
    const r = await scanForeignPosts();
    expect(r.foreign.map((f) => f.id).sort()).toEqual(['ext1', 'ext2']);
    const e1 = r.foreign.find((f) => f.id === 'ext1')!;
    expect(e1.issues.join(' ')).toMatch(/خارج نافذة النشر/);
    expect(e1.issues.join(' ')).toMatch(/عبارات ممنوعة/);
    expect(e1.issues.join(' ')).toMatch(/وعد بسرعة/);
    const n = await prisma.notification.findMany({ where: { code: 'FOREIGN_POSTS' } });
    expect(n).toHaveLength(1);
    expect(n[0].level).toBe('WARNING');
    await prisma.notification.deleteMany({});
    await scanForeignPosts();
    expect(await prisma.notification.count({ where: { code: 'FOREIGN_POSTS' } })).toBe(0); // already reported
  });
  it('advisor warns when n8n archive has no Drive folder', async () => {
    await seedBase({ accounts: 1 });
    await updateSettings((s) => ({ ...s, n8n: { ...s.n8n, enabled: true, webhookUrl: 'http://n8n:5678/webhook/x', events: ['publication.published'], gdriveFolderId: '' } }));
    expect((await runAdvisor()).advice.some((a) => a.id === 'archive_not_configured')).toBe(true);
    await updateSettings((s) => ({ ...s, n8n: { ...s.n8n, gdriveFolderId: '1C6llZ3Pekv_xN3TQlx3dD' } }));
    expect((await runAdvisor()).advice.some((a) => a.id === 'archive_not_configured')).toBe(false);
  });
});
