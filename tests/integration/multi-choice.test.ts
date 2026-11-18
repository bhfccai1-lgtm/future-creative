import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { generateAdvertisement, pickFromChoices } from '@/lib/pipeline/generate';
import { DirectionSchema } from '@/lib/validation';
import { captureQueues, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });

describe('campaign multi-choice: one of the chosen values at random per design', () => {
  it('picks only from the chosen products / formats / content types; empty lists stay automatic', async () => {
    await seedBase({ productCount: 6 });
    const ps = await prisma.product.findMany({ take: 3, orderBy: { slug: 'asc' } });
    const chosen = [ps[0].id, ps[1].id];
    const d = DirectionSchema.parse({ productIds: chosen, formats: ['REEL_VIDEO', 'IMAGE_FEED'], contentTypes: ['real_use', 'gift_idea'] });
    const seen = { p: new Set<string>(), f: new Set<string>(), c: new Set<string>() };
    for (const r of [0, 0.99, 0.4, 0.7]) {
      const x = await pickFromChoices({ direction: d } as { productId?: string; format?: string; direction?: typeof d }, () => r);
      seen.p.add(x.productId!); seen.f.add(x.format!); seen.c.add(x.direction!.contentType!);
    }
    expect([...seen.p].sort()).toEqual([...chosen].sort());
    expect([...seen.f].sort()).toEqual(['IMAGE_FEED', 'REEL_VIDEO']);
    expect(seen.c.size).toBe(2);
    // a fixed single value is never overridden; inactive products are skipped
    expect((await pickFromChoices({ productId: ps[2].id, format: 'IMAGE_STORY', direction: d }, () => 0)).productId).toBe(ps[2].id);
    await prisma.product.update({ where: { id: ps[0].id }, data: { active: false } });
    expect((await pickFromChoices({ direction: d } as { productId?: string; direction?: typeof d }, () => 0)).productId).toBe(ps[1].id);
    expect(await pickFromChoices({ direction: {} })).toEqual({ direction: {} });
  });
  it('a real generation uses one of the chosen products and formats', async () => {
    const { accounts } = await seedBase({ productCount: 6 });
    const ps = await prisma.product.findMany({ take: 2, orderBy: { slug: 'asc' } });
    const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 'campaign', direction: { productIds: ps.map((p) => p.id), formats: ['IMAGE_FEED', 'IMAGE_SQUARE'] } });
    expect(ps.map((p) => p.id)).toContain(r.advertisement.productId);
    expect(['IMAGE_FEED', 'IMAGE_SQUARE']).toContain(r.advertisement.format);
  });
});
