import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { generateAdvertisement, pickLeastRecent } from '@/lib/pipeline/generate';
import { DirectionSchema } from '@/lib/validation';
import { captureQueues, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });

describe('«تلقائي» format / design style / design method', () => {
  it('least-recent picker prefers unused, then the oldest', () => {
    expect(pickLeastRecent(['a', 'b', 'c'], ['a', 'b'])).toBe('c');
    expect(pickLeastRecent(['a', 'b', 'c'], ['c', 'a', 'b'])).toBe('b');
  });
  it('validation accepts auto values', () => {
    expect(DirectionSchema.parse({ designStyle: 'auto', renderMode: 'auto', autoFormat: true })).toMatchObject({ designStyle: 'auto' });
  });
  it('resolves auto style + method, records them, and varies the style', async () => {
    const { accounts } = await seedBase();
    const styles: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_FEED', direction: { designStyle: 'auto', renderMode: 'auto' } });
      const o = (await prisma.advertisement.findUniqueOrThrow({ where: { id: r.advertisement.id } })).options as { designStyle: string; direction: { renderMode: string; autoPicked: string[] } };
      expect(o.designStyle).not.toBe('auto');
      expect(o.direction.renderMode).toBe('layered'); // non-vertical format → verified system text
      expect(o.direction.autoPicked).toEqual(expect.arrayContaining(['designStyle', 'renderMode']));
      styles.push(o.designStyle);
    }
    expect(new Set(styles).size).toBe(3);
  });
  it('autoFormat uses the growth mix even on a fixed-format account', async () => {
    const { accounts } = await seedBase();
    expect(accounts[0].publishFormat).toBe('IMAGE_STORY');
    const formats = new Set<string>();
    for (let i = 0; i < 4; i++) formats.add((await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', direction: { autoFormat: true } })).advertisement.format);
    expect(formats.size).toBeGreaterThan(1);
  });
  it('campaign category: auto-picks products only from that category', async () => {
    const { accounts } = await seedBase();
    const cat = (await prisma.product.findFirstOrThrow()).categoryId;
    for (let i = 0; i < 3; i++) {
      const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_FEED', direction: { categoryId: cat } });
      expect((await prisma.product.findUniqueOrThrow({ where: { id: r.advertisement.productId } })).categoryId).toBe(cat);
    }
    await expect(generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_FEED', direction: { categoryId: 'missing' } })).rejects.toThrow(/فئة الحملة/);
  });
});
