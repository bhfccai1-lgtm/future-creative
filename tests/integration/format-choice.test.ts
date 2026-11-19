import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { nextFormatFor } from '@/lib/creative/format-mix';
import { AccountInput, patchSchema } from '@/lib/validation';
import { resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); });

describe('account formats chosen by the owner (several formats with shares)', () => {
  it('saves the chosen formats and rotates only between them, following the shares', async () => {
    const { accounts } = await seedBase();
    const data = patchSchema(AccountInput).parse({ formatStrategy: 'GROWTH_MIX', formatMix: { IMAGE_FEED: 2, IMAGE_SQUARE: 1 } });
    const acc = await prisma.socialAccount.update({ where: { id: accounts[0].id }, data });
    const product = await prisma.product.findFirstOrThrow();
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      const f = await nextFormatFor(acc);
      seen.push(f);
      await prisma.advertisement.create({ data: { accountId: acc.id, productId: product.id, format: f, language: 'ar', state: 'GENERATED', createdBy: 't' } });
    }
    expect(new Set(seen)).toEqual(new Set(['IMAGE_FEED', 'IMAGE_SQUARE']));
    expect(seen.filter((f) => f === 'IMAGE_FEED')).toHaveLength(4); // 2 : 1
  });
  it('rejects unknown formats', () => {
    expect(() => patchSchema(AccountInput).parse({ formatMix: { TV_AD: 50 } })).toThrow();
  });
});
