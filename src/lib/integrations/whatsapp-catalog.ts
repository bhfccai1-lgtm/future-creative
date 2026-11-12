import { prisma } from '../db';
import { env } from '../env';
import { getBusiness } from '../business';
import { displayWaPhone, waNumbers } from './whatsapp-numbers';
import { getSecret, getSettings, secretStatus, updateSettings } from '../settings';
import { signedMediaUrl } from '../storage';
import { audit } from '../audit';
import { log } from '../ops/log';

/**
 * Official WhatsApp catalogue sync: the products are written to the owner's Meta Commerce catalogue
 * (Catalog Batch API, POST /{catalog_id}/items_batch), which is connected to the WhatsApp Business number
 * in Commerce Manager. Only products with a starting price AND an approved design image are sent
 * (Meta requires both); everything else is reported so the owner can complete it. Inactive or out-of-scope
 * products are removed from the catalogue. The token is an encrypted secret and never leaves the server.
 */
export const IMAGE_TTL_SEC = 400 * 24 * 3600; // re-signed on every sync (daily), so Meta can always re-fetch
const USABLE_STATES = ['APPROVED', 'QUEUED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED'] as const;
const FORMAT_PREF = ['IMAGE_SQUARE', 'IMAGE_FEED', 'IMAGE_CAROUSEL', 'IMAGE_STORY'];
const BATCH = 1000; // Meta allows up to 5000 requests per call; smaller batches give clearer error reports

export interface CatalogItem { id: string; title: string; description: string; availability: 'in stock'; condition: 'new'; price: string; link: string; image_link: string; brand: string }
export interface CatalogPlan { items: CatalogItem[]; remove: string[]; missingPrice: { id: string; title: string }[]; missingImage: { id: string; title: string }[]; total: number }

export const productLink = (slug: string) => new URL(`/p/${encodeURIComponent(slug)}`, env().PUBLIC_BASE_URL).toString();

/** Best image per product: the latest approved/published non-trial design, square/feed preferred over stories. */
export async function productImages(productIds: string[]): Promise<Map<string, string>> {
  const ads = await prisma.advertisement.findMany({
    where: { productId: { in: productIds }, dryRun: false, state: { in: [...USABLE_STATES] }, format: { not: 'REEL_VIDEO' }, createdBy: { not: 'cross-promo' } },
    orderBy: { createdAt: 'desc' }, select: { productId: true, format: true, media: { where: { role: 'FINAL' }, select: { storageKey: true, mimeType: true }, take: 1 } },
  });
  const best = new Map<string, { rank: number; key: string }>();
  for (const a of ads) {
    const m = a.media[0];
    if (!m || !/^image\/(jpe?g|png)$/.test(m.mimeType)) continue;
    const rank = FORMAT_PREF.indexOf(a.format);
    const cur = best.get(a.productId);
    if (!cur || rank < cur.rank) best.set(a.productId, { rank, key: m.storageKey }); // newest first → first of each rank wins
  }
  return new Map([...best].map(([id, b]) => [id, b.key]));
}

const describe = (p: { titleAr: string; titleEn: string; catalogDescription: string | null; recommendedMessages: unknown }, phones: string) => {
  if (p.catalogDescription?.trim()) return p.catalogDescription.trim().slice(0, 5000);
  const m = (p.recommendedMessages ?? {}) as { ar?: string[]; en?: string[] };
  return [p.titleAr, ...(m.ar ?? []).slice(0, 2), `${p.titleEn}${m.en?.[0] ? ` — ${m.en[0]}` : ''}`, `للطلب واتساب: ${phones}`].join('\n').slice(0, 5000);
};

export async function planCatalog(): Promise<CatalogPlan> {
  const s = await getSettings();
  const b = await getBusiness();
  const phones = (await waNumbers()).filter((n) => n.inCatalog).map((n) => `${n.label} ${displayWaPhone(n.phone)}`).join(' · ');
  const all = await prisma.product.findMany({ select: { id: true, slug: true, active: true, categoryId: true, titleAr: true, titleEn: true, priceFrom: true, catalogDescription: true, recommendedMessages: true } });
  const cats = s.whatsapp.catalog.categoryIds;
  const inScope = all.filter((p) => p.active && (!cats.length || cats.includes(p.categoryId)));
  const images = await productImages(inScope.map((p) => p.id));
  const plan: CatalogPlan = { items: [], remove: [], missingPrice: [], missingImage: [], total: inScope.length };
  for (const p of inScope) {
    const key = images.get(p.id);
    if (p.priceFrom == null) { plan.missingPrice.push({ id: p.id, title: p.titleAr }); continue; }
    if (!key) { plan.missingImage.push({ id: p.id, title: p.titleAr }); continue; }
    plan.items.push({
      id: p.slug, title: p.titleAr.slice(0, 150), description: describe(p, phones), availability: 'in stock', condition: 'new',
      price: `${p.priceFrom.toFixed(b.currency === 'BHD' || b.currency === 'KWD' || b.currency === 'OMR' ? 3 : 2)} ${b.currency}`,
      link: productLink(p.slug), image_link: signedMediaUrl(key, IMAGE_TTL_SEC), brand: b.nameAr,
    });
  }
  const sent = new Set(plan.items.map((i) => i.id));
  plan.remove = all.filter((p) => !sent.has(p.slug)).map((p) => p.slug); // inactive, out of scope or incomplete → not shown
  return plan;
}

type Graph = { url: string; token: string };
async function graph(g: Graph, path: string, init?: RequestInit) {
  const r = await fetch(`${g.url}/${path}`, { ...init, headers: { Authorization: `Bearer ${g.token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(60_000) });
  const body = (await r.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } };
  if (!r.ok) throw new Error(`Meta ${r.status}: ${body.error?.message ?? 'request failed'}`);
  return body;
}

async function config() {
  const s = await getSettings();
  const token = await getSecret('META_CATALOG_TOKEN');
  const c = s.whatsapp.catalog;
  if (!c.catalogId) throw new Error('أدخل رقم الكتالوج (Catalog ID) من Commerce Manager');
  if (!token) throw new Error('أدخل رمز الوصول (Access token) للكتالوج');
  return { g: { url: `https://graph.facebook.com/${c.graphVersion}`, token } as Graph, catalogId: c.catalogId };
}

/** Reads the catalogue name — proves the id + token work without changing anything. */
export async function testCatalog() {
  const { g, catalogId } = await config();
  const r = await graph(g, `${catalogId}?fields=id,name,product_count`);
  return { name: String(r.name ?? ''), productCount: Number(r.product_count ?? 0) };
}

export async function syncWhatsappCatalog(actor = 'worker') {
  const started = new Date().toISOString();
  try {
    const { g, catalogId } = await config();
    const plan = await planCatalog();
    const requests = [
      ...plan.items.map((i) => ({ method: 'UPDATE', data: i })), // UPDATE upserts (allow_upsert defaults to true)
      ...plan.remove.map((id) => ({ method: 'DELETE', data: { id } })),
    ];
    const handles: string[] = [];
    for (let i = 0; i < requests.length; i += BATCH) {
      const r = await graph(g, `${catalogId}/items_batch`, { method: 'POST', body: JSON.stringify({ item_type: 'PRODUCT_ITEM', requests: requests.slice(i, i + BATCH) }) });
      for (const h of (r.handles as string[] | undefined) ?? []) handles.push(h);
    }
    // batches are asynchronous: poll briefly for item errors (deleting an item that is not in the catalogue is not an error for us)
    const errors: string[] = [];
    for (const h of handles) {
      for (let k = 0; k < 6; k++) {
        const st = await graph(g, `${catalogId}/check_batch_request_status?handle=${encodeURIComponent(h)}`);
        const d = ((st.data as { status?: string; errors?: { id?: string; message?: string }[] }[] | undefined) ?? [])[0];
        if (!d || d.status === 'finished' || d.status === 'error') {
          for (const e of d?.errors ?? []) if (!/not exist|not found/i.test(e.message ?? '')) errors.push(`${e.id ?? '?'}: ${e.message ?? ''}`);
          break;
        }
        await new Promise((res) => setTimeout(res, Number(process.env.WA_POLL_MS ?? 5000)));
      }
    }
    const message = `أُرسل ${plan.items.length} منتج · أُزيل ${plan.remove.length} · بلا سعر ${plan.missingPrice.length} · بلا صورة ${plan.missingImage.length}${errors.length ? ` · أخطاء Meta ${errors.length}: ${errors.slice(0, 3).join('؛ ')}` : ''}`;
    await updateSettings((s) => ({ ...s, whatsapp: { ...s.whatsapp, catalog: { ...s.whatsapp.catalog, lastSyncAt: started, lastSyncOk: errors.length === 0, lastSyncMessage: message } } }), actor);
    await audit({ actorLabel: actor, action: 'whatsapp.catalog_sync', targetType: 'integration', targetId: 'whatsapp-catalog', details: { sent: plan.items.length, removed: plan.remove.length, missingPrice: plan.missingPrice.length, missingImage: plan.missingImage.length, errors: errors.length } });
    return { ok: errors.length === 0, sent: plan.items.length, removed: plan.remove.length, missingPrice: plan.missingPrice.length, missingImage: plan.missingImage.length, errors, message };
  } catch (e) {
    const message = (e as Error).message;
    log.warn('whatsapp.catalog_sync_failed', { error: message });
    await updateSettings((s) => ({ ...s, whatsapp: { ...s.whatsapp, catalog: { ...s.whatsapp.catalog, lastSyncAt: started, lastSyncOk: false, lastSyncMessage: message } } }), actor).catch(() => undefined);
    return { ok: false, sent: 0, removed: 0, missingPrice: 0, missingImage: 0, errors: [message], message };
  }
}

/** Dashboard status: settings, whether the token/Telegram are configured, and what a sync would send now. */
export async function whatsappStatus() {
  const s = await getSettings();
  const plan = await planCatalog().catch(() => null);
  return {
    catalog: s.whatsapp.catalog, statusPack: s.whatsapp.statusPack, numbers: await waNumbers(), numbersConfigured: s.whatsapp.numbers.length > 0,
    token: (await secretStatus('META_CATALOG_TOKEN')).configured,
    telegram: (await secretStatus('TELEGRAM_BOT_TOKEN')).configured && !!s.n8n.telegramChatId,
    plan: plan && { total: plan.total, ready: plan.items.length, missingPrice: plan.missingPrice.length, missingImage: plan.missingImage.length, missingPriceSample: plan.missingPrice.slice(0, 8).map((p) => p.title), missingImageSample: plan.missingImage.slice(0, 8).map((p) => p.title) },
  };
}
