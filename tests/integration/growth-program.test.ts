import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { generateAdvertisement } from '@/lib/pipeline/generate';
import { setAiProviderOverride } from '@/lib/ai';
import { PHASES, programProgress, saveProgram, loadProgram, type GrowthProgram } from '@/lib/growth/program';
import { growthProgramReport } from '@/lib/growth/program-report';
import { captureQueues, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });

const prog = (accountId: string, startedDaysAgo: number): GrowthProgram => {
  const start = new Date(Date.now() - startedDaysAgo * 86400_000);
  return { startedAt: start.toISOString(), endsAt: new Date(start.getTime() + 30 * 86400_000).toISOString(), by: 'admin@test.bh', reports: [],
    accounts: [{ accountId, name: 'A', tier: 'grow', baseline: { followers: 100, reachPerContent: 10, content: 2, reelAvg: 0, postAvg: 10, engagementRate: null, reachRate: 10 }, targets: { followers: 105, reachPerContent: 14, contents: 60 }, findings: [] }] };
};

describe('growth program execution', () => {
  it('automatic designs take their content angle from the current program week', async () => {
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
    setAiProviderOverride(new FakeAiProvider());
    await saveProgram(prog(accounts[0].id, 8)); // week 2
    const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 'scheduler' });
    const dir = (r.advertisement.options as { direction: { contentType: string; autoPicked: string[] } }).direction;
    expect(PHASES[1].contentTypes).toContain(dir.contentType);
    expect(dir.autoPicked).toContain('contentType:growthProgram');
    const p = (await programProgress((await loadProgram())!, null))[0];
    expect(p.made).toBe(1);
  });
  it('sends one note per week and a final one, never twice', async () => {
    const { accounts } = await seedBase();
    await saveProgram(prog(accounts[0].id, 8));
    expect(await growthProgramReport()).toEqual({ sent: 2 });
    expect(await growthProgramReport()).toEqual({ skipped: 'ALREADY_SENT' });
    expect(await prisma.notification.count({ where: { code: 'GROWTH_PROGRAM' } })).toBe(1);
    await saveProgram(prog(accounts[0].id, 31));
    expect(await growthProgramReport()).toEqual({ sent: 5 });
  });
});
