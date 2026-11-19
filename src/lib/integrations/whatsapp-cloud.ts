import { createHmac, timingSafeEqual } from 'node:crypto';
import { prisma } from '../db';
import { audit, notify } from '../audit';
import { getSecret, getSettings } from '../settings';
import { redis } from '../queue/connection';
import { log } from '../ops/log';
import { createLead } from '../leads/service';
import { normalizeWaPhone } from './whatsapp-numbers';

/**
 * «واتساب الذكي» — the official WhatsApp Cloud API (Meta), two sides:
 *  1) OWNER COPILOT: messages from the owner's authorised numbers go to the smart assistant (same tools, same
 *     limits). An action comes back as a proposal; it runs only when the owner replies «تأكيد» within 15 minutes.
 *  2) CUSTOMERS: every customer who writes becomes (or updates) a lead in «العملاء والطلبات» with a notification;
 *     an optional welcome reply (off by default, once per 24 h per customer).
 * Incoming webhooks are verified with the app secret (X-Hub-Signature-256); each message id is handled once.
 */
export interface WaInbound { from: string; id: string; text: string; name: string | null }

export function verifyMetaSignature(raw: string, header: string | null, appSecret: string) {
  if (!header?.startsWith('sha256=') || !appSecret) return false;
  const want = Buffer.from('sha256=' + createHmac('sha256', appSecret).update(raw).digest('hex'));
  const got = Buffer.from(header);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** text messages out of a Cloud API webhook payload (other types are acknowledged with a short note) */
export function parseInbound(payload: unknown): WaInbound[] {
  const out: WaInbound[] = [];
  const entries = (payload as { entry?: { changes?: { value?: { contacts?: { wa_id?: string; profile?: { name?: string } }[]; messages?: { from?: string; id?: string; type?: string; text?: { body?: string }; button?: { text?: string }; interactive?: { button_reply?: { title?: string } } }[] } }[] }[] })?.entry ?? [];
  for (const e of entries) for (const c of e.changes ?? []) {
    const v = c.value ?? {};
    const names = new Map((v.contacts ?? []).map((k) => [k.wa_id, k.profile?.name ?? null]));
    for (const m of v.messages ?? []) {
      if (!m.from || !m.id) continue;
      const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? (m.type ? `[${m.type}]` : '');
      out.push({ from: m.from, id: m.id, text: text.slice(0, 1500), name: names.get(m.from) ?? null });
    }
  }
  return out;
}

export async function sendWhatsappText(to: string, body: string, fetchImpl: typeof fetch = fetch) {
  const s = (await getSettings()).whatsapp.cloud;
  const token = await getSecret('WA_CLOUD_TOKEN');
  if (!s.enabled || !s.phoneNumberId || !token) return { ok: false, reason: 'not_configured' };
  const r = await fetchImpl(`https://graph.facebook.com/${s.graphVersion}/${s.phoneNumberId}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: body.slice(0, 4000), preview_url: false } }),
    signal: AbortSignal.timeout(15_000),
  }).catch((e: Error) => { log.warn('wa.send_failed', { error: e.message }); return null; });
  if (!r?.ok) { log.warn('wa.send_rejected', { status: r?.status ?? null }); return { ok: false, reason: `http_${r?.status ?? 'network'}` }; }
  return { ok: true };
}

const CONFIRM = /^\s*(تأكيد|تاكيد|أكد|اكد|نعم|اي|إي|confirm|yes)\s*[.!✓✅]*\s*$/i;
const CANCEL = /^\s*(إلغاء|الغاء|لا|cancel|no)\s*[.!]*\s*$/i;

/** the owner's admin account (the assistant acts with its permissions) */
async function ownerUser() {
  const u = await prisma.user.findFirst({ where: { active: true, role: { name: 'ADMIN' } }, include: { role: true }, orderBy: { createdAt: 'asc' } });
  return u ? { sub: u.id, email: u.email, perms: u.role.permissions } : null;
}

async function ownerTurn(m: WaInbound, send: (to: string, t: string) => Promise<unknown>) {
  const { chat, executeProposal } = await import('../assistant/agent');
  const user = await ownerUser();
  if (!user) return;
  const kProp = `wa:prop:${m.from}`, kHist = `wa:hist:${m.from}`;
  if (CONFIRM.test(m.text)) {
    const raw = await redis().get(kProp);
    if (!raw) { await send(m.from, 'ما عندي طلب بانتظار التأكيد — اكتب طلبك من جديد.'); return; }
    await redis().del(kProp);
    try { const r = await executeProposal(user, JSON.parse(raw)); await send(m.from, r.message); }
    catch (e) { await send(m.from, `⚠️ ${(e as Error).message}`); }
    return;
  }
  if (CANCEL.test(m.text)) { await redis().del(kProp); await send(m.from, 'أُلغي — لم يُنفَّذ شيء.'); return; }
  const history = JSON.parse((await redis().get(kHist)) ?? '[]') as { role: 'user' | 'assistant'; content: string }[];
  let reply: string;
  try {
    const r = await chat(user, history, m.text);
    reply = r.reply;
    if (r.proposal) { await redis().set(kProp, JSON.stringify(r.proposal), 'EX', 15 * 60); reply += `\n\n📝 ${r.proposal.summary}\nللتنفيذ رد بكلمة «تأكيد» خلال ١٥ دقيقة، أو «إلغاء».`; }
  } catch (e) { reply = `⚠️ ${(e as Error).message}`; }
  await redis().set(kHist, JSON.stringify([...history, { role: 'user', content: m.text }, { role: 'assistant', content: reply }].slice(-10)), 'EX', 6 * 3600);
  await send(m.from, reply);
}

async function customerTurn(m: WaInbound, send: (to: string, t: string) => Promise<unknown>) {
  const s = (await getSettings()).whatsapp.cloud;
  const contact = `+${m.from}`;
  const open = await prisma.lead.findFirst({ where: { contact, status: { in: ['NEW', 'CONTACTED', 'QUOTED'] }, createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } }, orderBy: { createdAt: 'desc' } });
  const at = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bahrain', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date());
  if (open) {
    await prisma.lead.update({ where: { id: open.id }, data: { notes: `${open.notes ? `${open.notes}\n` : ''}[${at} واتساب] ${m.text}`.slice(-4000), nextFollowUpAt: new Date() } });
  } else {
    const owner = await ownerUser();
    if (!owner) return;
    const system = { sub: owner.sub, email: 'whatsapp (auto)' }; // audited as the WhatsApp channel, under the owner
    const lead = await createLead({ name: m.name, contact, need: m.text.slice(0, 300) || 'رسالة واتساب', source: 'whatsapp', notes: `[${at} واتساب] ${m.text}`.slice(0, 4000) }, system);
    await notify('INFO', 'WA_NEW_CUSTOMER', `💬 عميل جديد على الواتساب: ${m.name ?? contact}`, `«${m.text.slice(0, 200)}» — في «العملاء والطلبات» (رد من نفس المحادثة).`).catch(() => undefined);
    void lead;
  }
  if (s.autoAck && (await redis().set(`wa:ack:${m.from}`, '1', 'EX', 24 * 3600, 'NX')) === 'OK') await send(m.from, s.ackText);
}

/** one webhook delivery: every text message is handled once (Meta retries deliveries) */
export async function handleInbound(payload: unknown, send: (to: string, t: string) => Promise<unknown> = (to, t) => sendWhatsappText(to, t)) {
  const s = (await getSettings()).whatsapp.cloud;
  if (!s.enabled) return { handled: 0 };
  const owners = new Set(s.ownerNumbers.map((x) => normalizeWaPhone(x) ?? x));
  let handled = 0;
  for (const m of parseInbound(payload)) {
    if ((await redis().set(`wa:msg:${m.id}`, '1', 'EX', 3 * 86400, 'NX')) !== 'OK') continue; // duplicate delivery
    try {
      if (owners.has(m.from)) await ownerTurn(m, send); else await customerTurn(m, send);
      handled++;
    } catch (e) { log.warn('wa.inbound_failed', { error: (e as Error).message }); }
  }
  if (handled) await audit({ actorLabel: 'whatsapp', action: 'whatsapp.inbound', details: { handled } }).catch(() => undefined);
  return { handled };
}
