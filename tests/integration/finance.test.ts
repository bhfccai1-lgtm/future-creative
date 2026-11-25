import { beforeEach, describe, expect, it, vi } from 'vitest';

// the advisor reads the REAL disk; tests must not depend on the free space of the machine running them
vi.mock('node:fs/promises', async (orig) => ({ ...(await orig<typeof import('node:fs/promises')>()), statfs: async () => ({ bavail: 60_000_000, blocks: 100_000_000, bsize: 4096 }) }));
import { prisma } from '@/lib/db';
import { BHD_PER_USD, financeFrom, financeReport } from '@/lib/ops/finance';
import { runAdvisor } from '@/lib/ops/advisor';
import { HEARTBEAT_KEY } from '@/lib/ops/diagnostics';
import { redis } from '@/lib/queue/connection';
import { captureQueues, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); await redis().set(HEARTBEAT_KEY, String(Date.now())); });

describe('💰 financial + predictive intelligence', () => {
  it('return, per-account estimate and forecast come only from real rows, with honest confidence', () => {
    const r = financeFrom({
      days: 30, spendUsd: 10,
      accounts: [{ id: 'a', name: 'gifts', designs: 30 }, { id: 'b', name: 'stickers', designs: 10 }, { id: 'c', name: 'idle', designs: 0 }],
      leads: [
        { accountId: 'a', status: 'WON', valueBhd: 20, wonAt: new Date() },
        { accountId: 'a', status: 'QUOTED', valueBhd: null, wonAt: null },
        { accountId: 'b', status: 'LOST', valueBhd: null, wonAt: null },
      ],
      decided90: [{ status: 'WON' }, { status: 'LOST' }, { status: 'LOST' }, { status: 'WON' }],
      open: [{ status: 'QUOTED', valueBhd: 30 }, { status: 'NEW', valueBhd: null }],
      wonThisMonthBhd: 20,
    });
    expect(r.spendBhd).toBeCloseTo(10 * BHD_PER_USD, 3);
    expect(r.revenueBhd).toBe(20);
    expect(r.roi).toBeCloseTo(20 / 3.76, 1);
    const gifts = r.accounts.find((a) => a.id === 'a')!;
    expect(gifts.estCostBhd).toBeCloseTo(3.76 * 0.75, 3); // the spend shared by number of designs (an estimate)
    expect(r.accounts[0].id).toBe('a'); // ranked by revenue
    expect(r.noReturn).toHaveLength(0); // stickers has a lead (lost) → not "no return"; idle has no designs
    // forecast: won this month + open pipeline (30) × win rate (2/4)
    expect(r.forecast.winRate).toBe(0.5);
    expect(r.forecast.expectedBhd).toBe(35);
    expect(r.forecast.confidence).toBe('low'); // 4 decisions → low
  });

  it('no data → no invented numbers', () => {
    const r = financeFrom({ days: 30, spendUsd: 0, accounts: [], leads: [], decided90: [], open: [], wonThisMonthBhd: 0 });
    expect(r.roi).toBeNull();
    expect(r.forecast.winRate).toBeNull();
    expect(r.forecast.expectedBhd).toBe(0);
  });

  it('the advisor flags an account that keeps costing designs with no recorded customer', async () => {
    const { accounts } = await seedBase();
    const [busy, earning] = accounts;
    const product = await prisma.product.findFirstOrThrow();
    for (let i = 0; i < 6; i++) await prisma.advertisement.create({ data: { accountId: busy.id, productId: product.id, format: 'IMAGE_FEED', language: 'ar', state: 'PUBLISHED', createdBy: 't' } });
    for (let i = 0; i < 6; i++) await prisma.advertisement.create({ data: { accountId: earning.id, productId: product.id, format: 'IMAGE_FEED', language: 'ar', state: 'PUBLISHED', createdBy: 't' } });
    await prisma.aiUsage.create({ data: { provider: 'openai', model: 'x', kind: 'image', costUsd: '4' } });
    await prisma.lead.create({ data: { need: 'أكواب', accountId: earning.id, status: 'WON', valueBhd: 25, wonAt: new Date() } });
    const fin = await financeReport();
    expect(fin.revenueBhd).toBe(25);
    expect(fin.noReturn.map((a) => a.id)).toEqual([busy.id]);
    const a = (await runAdvisor()).advice.find((x) => x.id === 'account_no_return')!;
    expect(a.evidence).toContain(busy.name);
    expect(a.evidence).not.toContain(earning.name);
    expect(a.why).toMatch(/تقديرية/); // honest about the estimate
  });
});
