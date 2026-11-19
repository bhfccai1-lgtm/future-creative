import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { assertDailyLimits } from '@/lib/pipeline/generate';
import { resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); });

describe('per-account daily design limit', () => {
  it('failed designs and dry-run previews do not use the account quota; the message says how to raise it', async () => {
    const { accounts } = await seedBase();
    const acc = accounts[0];
    const product = await prisma.product.findFirstOrThrow();
    const mk = (state: 'FAILED' | 'GENERATED', dryRun = false) => prisma.advertisement.create({ data: { accountId: acc.id, productId: product.id, format: 'IMAGE_STORY', language: 'ar', state, dryRun, createdBy: 't' } });
    await mk('FAILED'); await mk('FAILED'); await mk('GENERATED', true);
    const s = await getSettings();
    await expect(assertDailyLimits(s, acc.id, 1)).resolves.toBeUndefined();
    await mk('GENERATED');
    await expect(assertDailyLimits(s, acc.id, 1)).rejects.toThrow(/1 من 1.*منتصف الليل.*تعديل الحساب/);
  });
});
