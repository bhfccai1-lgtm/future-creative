import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { setSecret, updateSettings } from '@/lib/settings';
import { setupChecklist } from '@/lib/ops/setup-checklist';
import { captureQueues, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });

describe('setup center', () => {
  it('reads live status and points to the first missing required step', async () => {
    await seedBase({ accounts: 2 });
    let c = await setupChecklist();
    const byId = (id: string) => c.items.find((i) => i.id === id)!;
    expect(byId('ai').done).toBe(false); // dry-run by default
    expect(byId('metricool').done).toBe(true); // both test accounts connected
    expect(c.next!.id).toBe('ai');
    await setSecret('OPENAI_API_KEY', 'sk-test-123456789');
    await updateSettings((s) => ({ ...s, ai: { ...s.ai, dryRun: false, bestOf: 2, qualityByFormat: { ...s.ai.qualityByFormat, IMAGE_FEED: 'high', REEL_VIDEO: 'high' } }, growth: { ...s.growth, peakHours: { ...s.growth.peakHours, enabled: true } } }));
    await prisma.socialAccount.updateMany({ data: { formatStrategy: 'GROWTH_MIX' } });
    c = await setupChecklist();
    expect(['ai', 'recommended', 'quality', 'peak'].every((id) => c.items.find((i) => i.id === id)!.done)).toBe(true);
    expect(c.next!.id).toBe('autopublish');
    expect(c.items.find((i) => i.id === 'gbp')!.optional).toBe(true); // no Google profile linked
    expect(c.done).toBeGreaterThanOrEqual(5);
  });
});
