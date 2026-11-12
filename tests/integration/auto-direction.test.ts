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
  it('art direction rotates composition, lighting and lens across consecutive designs', async () => {
    const { accounts } = await seedBase();
    const arts: { composition: string; lighting: string; lens: string }[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_FEED' });
      arts.push(((await prisma.advertisement.findUniqueOrThrow({ where: { id: r.advertisement.id } })).options as { direction: { art: typeof arts[number] } }).direction.art);
    }
    expect(new Set(arts.map((a) => a.composition)).size).toBe(4);
    expect(new Set(arts.map((a) => a.lighting)).size).toBe(4);
    expect(new Set(arts.map((a) => `${a.composition}|${a.lens}`)).size).toBe(4);
    for (const a of arts) if (a.composition === 'flat_lay') expect(a.lens).toBe('overhead');
  });
  it('Saudi accounts default to the Saudi/GCC market (no Bahrain context)', async () => {
    const { accounts } = await seedBase();
    await prisma.socialAccount.update({ where: { id: accounts[0].id }, data: { name: 'Ksafcc' } });
    const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_FEED' });
    expect(((await prisma.advertisement.findUniqueOrThrow({ where: { id: r.advertisement.id } })).options as { direction: { market: string } }).direction.market).toBe('gcc_saudi');
    const b = await generateAdvertisement({ accountId: accounts[1].id, createdBy: 't', format: 'IMAGE_FEED' });
    expect(((await prisma.advertisement.findUniqueOrThrow({ where: { id: b.advertisement.id } })).options as { direction: { market?: string } }).direction.market).toBeUndefined();
  });
  it('a user-chosen composition is kept', async () => {
    const { accounts } = await seedBase();
    const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_FEED', direction: { designType: 'macro_detail' } });
    const art = ((await prisma.advertisement.findUniqueOrThrow({ where: { id: r.advertisement.id } })).options as { direction: { art: { composition: string; lens: string } } }).direction.art;
    expect(art.composition).toBe('macro_detail');
    expect(['85mm', '50mm']).toContain(art.lens);
  });
  it('production default for automatic designs: signature style; «auto» method = full AI poster for stories on approval accounts, layered on autonomous ones; colour by category', async () => {
    const { accounts } = await seedBase({ autoRenderMode: 'auto' });
    const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 'scheduler', format: 'IMAGE_STORY' });
    const o = (await prisma.advertisement.findUniqueOrThrow({ where: { id: r.advertisement.id } })).options as { direction: { renderMode: string; designStyle: string } };
    expect(o.direction).toMatchObject({ renderMode: 'ai_full', designStyle: 'fc_signature' });
    await prisma.socialAccount.update({ where: { id: accounts[1].id }, data: { autonomousAuthorized: true } });
    const r2 = await generateAdvertisement({ accountId: accounts[1].id, createdBy: 'scheduler', format: 'IMAGE_STORY' });
    expect(((await prisma.advertisement.findUniqueOrThrow({ where: { id: r2.advertisement.id } })).options as { direction: { renderMode: string } }).direction.renderMode).toBe('layered');
    const { paletteFor } = await import('@/lib/creative/options');
    expect(paletteFor({}, 'الأعراس والحفلات')!.decor).toMatch(/blush/);
    expect(paletteFor({ occasion: 'bahrain_national_day' }, 'الأعراس والحفلات')!.theme).toBe('festive_red'); // occasion wins
  });
});
