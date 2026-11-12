import { prisma } from '../db';
import { getBusiness, locationsOf, ctaFor } from '../business';
import { getSecret, getSettings } from '../settings';
import { signedMediaUrl } from '../storage';
import { publishableMedia } from '../publishing/media';
import { startOfDayInTz } from '../time';
import type { Lang } from '../render/fonts';
import { log } from '../ops/log';

/**
 * «حزمة حالة واتساب»: WhatsApp has no official API for posting Status, and unofficial automation
 * risks banning the business number — so the system never posts to Status itself. Instead, the best
 * verified posts of the day (reels / stories / feed) are sent to the owner's Telegram with a short,
 * ready-to-copy status text; posting them takes a few seconds from the phone.
 */
const SENT_KEY = 'wa_status:sent';

async function sentIds(): Promise<string[]> {
  const row = await prisma.systemSetting.findUnique({ where: { key: SENT_KEY } });
  return ((row?.value as { ids?: string[] } | null)?.ids ?? []);
}
async function markSent(ids: string[]) {
  const value = { ids: ids.slice(-300) };
  await prisma.systemSetting.upsert({ where: { key: SENT_KEY }, create: { key: SENT_KEY, value }, update: { value } });
}

export function statusText(o: { headline: string | null; productTitle: string; cta: string; phones: string; lang: Lang }) {
  const head = (o.headline || o.productTitle).trim();
  return `${head} ✨\n${o.cta} 👇\n${o.phones}`.slice(0, 700);
}

async function tg(token: string, method: string, body: Record<string, unknown>) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  if (!r.ok || !j.ok) throw new Error(`Telegram: ${j.description ?? r.status}`);
}

/** Candidates: verified primary publications of the last 24 h, newest first, not sent before, from the chosen accounts. */
async function candidates(accountIds: string[], exclude: Set<string>) {
  const res = await prisma.publicationResult.findMany({
    where: { verifiedAt: { gte: new Date(Date.now() - 24 * 3600_000) }, job: { primary: true, ...(accountIds.length ? { accountId: { in: accountIds } } : {}) } },
    orderBy: { verifiedAt: 'desc' }, take: 50,
    select: { job: { select: { advertisement: { include: { media: true, product: true, account: true } } } } },
  });
  const seen = new Set<string>();
  return res.map((r) => r.job.advertisement).filter((a) => {
    if (exclude.has(a.id) || seen.has(a.productId) || a.createdBy === 'cross-promo' || a.dryRun) return false;
    seen.add(a.productId); // one design per product → variety in the status
    return true;
  }).sort((x, y) => Number(y.format === 'REEL_VIDEO') - Number(x.format === 'REEL_VIDEO')); // reels first: motion works best in Status
}

export async function sendStatusPacks(opts: { force?: boolean } = {}) {
  const s = await getSettings();
  const cfg = s.whatsapp.statusPack;
  if (!cfg.enabled && !opts.force) return { sent: 0, reason: 'disabled' };
  const token = await getSecret('TELEGRAM_BOT_TOKEN');
  const chatId = s.n8n.telegramChatId;
  if (!token || !chatId) return { sent: 0, reason: 'telegram_not_configured' };
  const sent = await sentIds();
  // daily cap (Bahrain day) — counted from what was already sent today
  const since = startOfDayInTz();
  const todayCount = await prisma.auditLog.count({ where: { action: 'whatsapp.status_pack', createdAt: { gte: since } } }).catch(() => 0);
  const room = Math.min(1, Math.max(0, opts.force ? 1 : cfg.maxPerDay - todayCount)); // one per run (hourly) → spread over the day
  if (!room) return { sent: 0, reason: 'daily_cap' };
  const list = (await candidates(cfg.accountIds, new Set(sent))).slice(0, room);
  if (!list.length) return { sent: 0, reason: 'nothing_new' };
  const b = await getBusiness();
  const phones = locationsOf(b).map((l) => `📞 ${l.nameAr} ${l.phone}`).join('\n');
  let n = 0;
  for (const ad of list) {
    const media = publishableMedia(ad)[0];
    if (!media) continue;
    const lang = (ad.language as Lang) ?? 'ar';
    const text = statusText({ headline: ad.headline, productTitle: ad.product.titleAr, cta: ctaFor(b, lang), phones, lang });
    const url = signedMediaUrl(media.storageKey, 3 * 24 * 3600);
    try {
      const isVideo = media.mimeType.startsWith('video/');
      await tg(token, isVideo ? 'sendVideo' : 'sendPhoto', { chat_id: chatId, [isVideo ? 'video' : 'photo']: url, caption: `🟢 حالة واتساب جاهزة — ${ad.account.name}\nاحفظ ${isVideo ? 'الفيديو' : 'الصورة'} ثم انشرها في الحالة، وانسخ النص:` });
      await tg(token, 'sendMessage', { chat_id: chatId, text });
      sent.push(ad.id); n++;
      await prisma.auditLog.create({ data: { actorLabel: 'whatsapp-status', action: 'whatsapp.status_pack', targetType: 'advertisement', targetId: ad.id, details: { account: ad.account.name, format: ad.format } } });
    } catch (e) { log.warn('whatsapp.status_pack_failed', { adId: ad.id, error: (e as Error).message }); if (opts.force) throw e; }
  }
  await markSent(sent);
  return { sent: n, reason: n ? 'ok' : 'send_failed' };
}
