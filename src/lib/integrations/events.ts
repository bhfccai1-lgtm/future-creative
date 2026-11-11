import { createHmac, randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { getSecret, getSettings } from '../settings';
import { log } from '../ops/log';
import { env } from '../env';

/** Every event the system can send to n8n. Payloads never contain secrets or tokens. */
export const EVENTS = {
  'ad.ready_for_review': 'تصميم جديد بانتظار المراجعة',
  'ad.approved': 'تم اعتماد تصميم',
  'publication.scheduled': 'استلم Metricool المنشور (مجدول)',
  'publication.published': 'تم تأكيد النشر من المزود',
  'publication.failed': 'فشل النشر',
  'publication.unknown': 'نتيجة نشر غير مؤكدة — تحتاج قرارًا',
  'connection.lost': 'انقطع ربط حساب',
  'report.weekly': 'التقرير الأسبوعي',
  'test.ping': 'اختبار الربط',
} as const;
export type EventName = keyof typeof EVENTS;

const BACKOFF_MIN = [1, 5, 15, 60, 360]; // minutes between attempts; after the last → DEAD
export const MAX_ATTEMPTS = BACKOFF_MIN.length + 1;

/** HMAC-SHA256 over `${timestamp}.${body}` — n8n verifies it (see deploy/n8n/README.md). */
export function sign(secret: string, timestamp: string, body: string) {
  return 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/**
 * Queues an event in the durable outbox (never throws into the business flow).
 * Nothing is queued unless n8n is enabled, a URL is set and the event is subscribed.
 */
export async function emitEvent(event: EventName, data: Record<string, unknown>) {
  try {
    const s = await getSettings();
    if (!s.n8n.enabled || !s.n8n.webhookUrl || (event !== 'test.ping' && !s.n8n.events.includes(event))) return null;
    const base = env().PUBLIC_BASE_URL.replace(/\/$/, '');
    const payload = { id: randomUUID(), event, title: EVENTS[event], occurredAt: new Date().toISOString(), timezone: 'Asia/Bahrain', dashboard: base, data };
    return await prisma.webhookDelivery.create({ data: { event, payload: payload as Prisma.InputJsonValue, target: s.n8n.webhookUrl } });
  } catch (e) { log.warn('n8n.emit_failed', { event, error: (e as Error).message }); return null; }
}

/** Worker: delivers due events with signature, timeout and exponential backoff. */
export async function deliverPending(fetchImpl: typeof fetch = fetch, now = new Date()) {
  const due = await prisma.webhookDelivery.findMany({ where: { status: 'PENDING', nextAttemptAt: { lte: now } }, orderBy: { createdAt: 'asc' }, take: 50 });
  if (!due.length) return { delivered: 0, failed: 0 };
  const secret = await getSecret('N8N_WEBHOOK_SECRET');
  let delivered = 0, failed = 0;
  for (const d of due) {
    // claim (another worker may be running)
    const claim = await prisma.webhookDelivery.updateMany({ where: { id: d.id, status: 'PENDING', attempts: d.attempts }, data: { attempts: { increment: 1 } } });
    if (!claim.count) continue;
    const body = JSON.stringify(d.payload);
    const ts = String(Math.floor(now.getTime() / 1000));
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-FC-Event': d.event, 'X-FC-Delivery': d.id, 'X-FC-Timestamp': ts, 'User-Agent': 'FutureCreative-Webhooks/1.0' };
    if (secret) headers['X-FC-Signature'] = sign(secret, ts, body);
    let status: number | null = null; let error: string | null = null;
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 10_000);
    try { const r = await fetchImpl(d.target, { method: 'POST', headers, body, signal: ctrl.signal }); status = r.status; if (!r.ok) error = `HTTP ${r.status}`; }
    catch (e) { error = (e as Error).message.slice(0, 300); }
    finally { clearTimeout(t); }
    const attempt = d.attempts + 1;
    if (!error) {
      await prisma.webhookDelivery.update({ where: { id: d.id }, data: { status: 'DELIVERED', deliveredAt: new Date(), lastStatus: status, lastError: null } });
      delivered++;
    } else {
      const dead = attempt >= MAX_ATTEMPTS || (status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429);
      await prisma.webhookDelivery.update({ where: { id: d.id }, data: { status: dead ? 'DEAD' : 'PENDING', lastStatus: status, lastError: error, nextAttemptAt: new Date(now.getTime() + BACKOFF_MIN[Math.min(attempt - 1, BACKOFF_MIN.length - 1)] * 60_000) } });
      failed++;
      log.warn('n8n.delivery_failed', { deliveryId: d.id, event: d.event, attempt, status, error, dead });
    }
  }
  return { delivered, failed };
}
