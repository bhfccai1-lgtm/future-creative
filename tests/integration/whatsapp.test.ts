import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { setSecret, updateSettings, getSettings } from '@/lib/settings';
import { generateAdvertisement } from '@/lib/pipeline/generate';
import { setAiProviderOverride } from '@/lib/ai';
import { parseProductCsv, priceOf, withDefaults } from '@/lib/catalog/import';
import { planCatalog, syncWhatsappCatalog } from '@/lib/integrations/whatsapp-catalog';
import { sendStatusPacks } from '@/lib/integrations/whatsapp-status';
import { captureQueues, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); process.env.WA_POLL_MS = '1'; });
afterEach(() => { vi.unstubAllGlobals(); });

async function setup() {
  const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
  setAiProviderOverride(new FakeAiProvider());
  return accounts;
}
/** a design that a human approved and that the provider confirmed as published */
async function published(accountId: string, format: 'IMAGE_FEED' | 'IMAGE_STORY' = 'IMAGE_FEED') {
  const ad = (await generateAdvertisement({ accountId, createdBy: 't', format })).advertisement;
  await prisma.advertisement.update({ where: { id: ad.id }, data: { state: 'PUBLISHED' } });
  const job = await prisma.publicationJob.create({ data: { idempotencyKey: `k-${ad.id}`, advertisementId: ad.id, accountId, provider: 'metricool', state: 'PUBLISHED', scheduledFor: new Date() } });
  await prisma.publicationResult.create({ data: { jobId: job.id, verifiedAt: new Date(), providerStatus: 'PUBLISHED' } });
  return ad;
}
const okJson = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('catalogue prices in the product import', () => {
  it('reads the price column (Arabic digits, comma decimals) and never wipes a price with an empty cell', () => {
    expect([priceOf('2.5'), priceOf('٢٫٥ د.ب'), priceOf('BHD 3'), priceOf('2-5'), priceOf('')]).toEqual([2.5, 2.5, 3, null, null]);
    const { rows, errors } = parseProductCsv('الاسم,الفئة,السعر\nأكواب,هدايا,1.500\nملصقات,طباعة,\nدفاتر,طباعة,غالي\n');
    expect(rows.map((r) => r.price)).toEqual([1.5, null]);
    expect(errors[0].message).toMatch(/السعر غير صحيح/);
    expect(withDefaults(rows[0])).toMatchObject({ priceFrom: 1.5 });
    expect(withDefaults(rows[1])).not.toHaveProperty('priceFrom');
  });
});

describe('WhatsApp catalogue sync (Meta Catalog Batch API)', () => {
  it('sends only priced products that have an approved design; removes the rest', async () => {
    const accounts = await setup();
    const ad = await published(accounts[0].id);
    await prisma.product.update({ where: { id: ad.productId }, data: { priceFrom: 1.5 } });
    const other = await prisma.product.findFirstOrThrow({ where: { id: { not: ad.productId } } });
    await prisma.product.update({ where: { id: other.id }, data: { priceFrom: 2 } }); // priced but no design yet
    const plan = await planCatalog();
    expect(plan.items).toHaveLength(1);
    const p = await prisma.product.findUniqueOrThrow({ where: { id: ad.productId } });
    expect(plan.items[0]).toMatchObject({ id: p.slug, price: '1.500 BHD', availability: 'in stock', condition: 'new' });
    expect(plan.items[0].link).toMatch(new RegExp(`/p/${p.slug}$`));
    expect(plan.items[0].image_link).toMatch(/\/api\/m\//);
    expect(plan.items[0].description).toMatch(/33316319/);
    expect(plan.missingImage.map((x) => x.id)).toContain(other.id);
    expect(plan.missingPrice.length).toBe(plan.total - 2);
    expect(plan.remove).not.toContain(p.slug);
  });

  it('posts the batch with the encrypted token, polls the status and records the result', async () => {
    const accounts = await setup();
    const ad = await published(accounts[0].id);
    await prisma.product.update({ where: { id: ad.productId }, data: { priceFrom: 1 } });
    await updateSettings((s) => ({ ...s, whatsapp: { ...s.whatsapp, catalog: { ...s.whatsapp.catalog, enabled: true, catalogId: '123456' } } }));
    await setSecret('META_CATALOG_TOKEN', 'EA' + 'x'.repeat(60));
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes('/items_batch')) return okJson({ handles: ['h1'] });
      if (url.includes('check_batch_request_status')) return okJson({ data: [{ status: 'finished', errors: [{ id: 'gone', message: 'Item does not exist' }] }] });
      return okJson({});
    }));
    const r = await syncWhatsappCatalog('test');
    expect(r).toMatchObject({ ok: true, sent: 1 });
    const batch = calls.find((c) => c.url.includes('/123456/items_batch'))!;
    expect((batch.init!.headers as Record<string, string>).Authorization).toBe('Bearer EA' + 'x'.repeat(60));
    const body = JSON.parse(String(batch.init!.body));
    expect(body.item_type).toBe('PRODUCT_ITEM');
    expect(body.requests.filter((q: { method: string }) => q.method === 'UPDATE')).toHaveLength(1);
    expect(body.requests.some((q: { method: string }) => q.method === 'DELETE')).toBe(true);
    expect((await getSettings()).whatsapp.catalog).toMatchObject({ lastSyncOk: true });
  });

  it('without catalogue id / token: clear error, no network call', async () => {
    await setup();
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    const r = await syncWhatsappCatalog('test');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Catalog ID/);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('WhatsApp status pack (Telegram, manual posting)', () => {
  it('sends one verified post per run with ready text, never the same post twice, respects the daily cap', async () => {
    const accounts = await setup();
    await updateSettings((s) => ({ ...s, n8n: { ...s.n8n, telegramChatId: '42' }, whatsapp: { ...s.whatsapp, statusPack: { enabled: true, maxPerDay: 2, accountIds: [] } } }));
    await setSecret('TELEGRAM_BOT_TOKEN', '123:abc');
    await published(accounts[0].id);
    await published(accounts[1].id, 'IMAGE_STORY');
    const sent: { method: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { sent.push({ method: url.split('/').pop()!, body: JSON.parse(String(init!.body)) }); return okJson({ ok: true }); }));
    expect((await sendStatusPacks()).sent).toBe(1);
    expect(sent.map((x) => x.method)).toEqual(['sendPhoto', 'sendMessage']);
    expect(String(sent[1].body.text)).toMatch(/33316319/);
    expect((await sendStatusPacks()).sent).toBe(1);
    expect(await sendStatusPacks()).toMatchObject({ sent: 0, reason: 'daily_cap' });
    await updateSettings((s) => ({ ...s, whatsapp: { ...s.whatsapp, statusPack: { ...s.whatsapp.statusPack, maxPerDay: 5 } } }));
    expect(await sendStatusPacks()).toMatchObject({ sent: 0, reason: 'nothing_new' });
    expect(sent.filter((x) => x.method !== 'sendMessage')).toHaveLength(2);
  });
  it('disabled → nothing is sent', async () => {
    await setup();
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    expect(await sendStatusPacks()).toMatchObject({ sent: 0, reason: 'disabled' });
    expect(f).not.toHaveBeenCalled();
  });
});
