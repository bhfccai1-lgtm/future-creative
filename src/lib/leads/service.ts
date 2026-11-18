import { prisma } from '../db';
import { audit, notify } from '../audit';
import { AppError } from '../errors';
import type { Quote, QuoteItem, ScriptKey, Touch } from './scripts';
import { quoteTotals } from './scripts';
import { getSettings } from '../settings';
import { Prisma } from '@prisma/client';

/**
 * «العملاء والطلبات» — the sales side of marketing: every inquiry is followed until it becomes an order or is closed.
 *  - comments classified as order / price questions become leads automatically (one per comment)
 *  - phone / WhatsApp / branch-visit customers are added by hand with «من أي حساب عرفنا؟» for attribution
 *  - follow-up reminders; speed-to-lead; won value per account (recorded by the owner, never estimated)
 */
export const STATUSES = ['NEW', 'CONTACTED', 'QUOTED', 'WON', 'LOST'] as const;
export type LeadStatus = (typeof STATUSES)[number];
export const STATUS_AR: Record<LeadStatus, string> = { NEW: 'جديد', CONTACTED: 'تم التواصل', QUOTED: 'أُرسل عرض سعر', WON: 'تم الطلب ✓', LOST: 'لم يكتمل' };
export const SOURCES = ['comment', 'whatsapp', 'phone', 'walkin', 'dm', 'other'] as const;
export const SOURCE_AR: Record<string, string> = { comment: 'تعليق', whatsapp: 'واتساب', phone: 'اتصال', walkin: 'زيارة الفرع', dm: 'رسالة إنستغرام', other: 'أخرى', manual: 'يدوي' };
export const LOST_REASONS = ['السعر', 'الوقت / الاستعجال', 'ذهب لمنافس', 'لم يرد', 'ألغى الفكرة', 'أخرى'];
const OPEN: LeadStatus[] = ['NEW', 'CONTACTED', 'QUOTED'];
const DAY = 86400_000;
/** Default follow-up after each step (days). */
export const FOLLOW_UP_DAYS: Partial<Record<LeadStatus, number>> = { NEW: 0, CONTACTED: 2, QUOTED: 2 };

/** Comments that ask to buy or ask the price become leads (idempotent per comment). */
export async function leadsFromComments(ids?: string[]) {
  const rows = await prisma.socialComment.findMany({ where: { category: { in: ['order', 'price'] }, ...(ids ? { id: { in: ids } } : {}) }, select: { id: true, accountId: true, username: true, text: true, createdAt: true } });
  if (!rows.length) return 0;
  const r = await prisma.lead.createMany({
    data: rows.map((c) => ({ accountId: c.accountId, commentId: c.id, source: 'comment', name: c.username ? `@${c.username.replace(/^@/, '')}` : null, contact: c.username ? `@${c.username.replace(/^@/, '')}` : null, need: c.text.slice(0, 500), nextFollowUpAt: c.createdAt, createdBy: 'comments' })),
    skipDuplicates: true,
  });
  return r.count;
}

export interface LeadInput { name?: string | null; contact?: string | null; need: string; source: string; accountId?: string | null; productId?: string | null; notes?: string | null; valueBhd?: number | null }
export async function createLead(input: LeadInput, actor: { sub: string; email: string }) {
  const lead = await prisma.lead.create({ data: { ...input, source: (SOURCES as readonly string[]).includes(input.source) ? input.source : 'other', status: 'NEW', nextFollowUpAt: new Date(), createdBy: actor.email } });
  await audit({ actorId: actor.sub, actorLabel: actor.email, action: 'lead.create', targetType: 'lead', targetId: lead.id, details: { source: lead.source } });
  return lead;
}

/** «45.500 د.ب» / «٤٥٫٥» / 45 → 45.5 — the first number in the text (Arabic or Latin digits). */
export const parseBhd = (v: unknown) => {
  if (v == null || v === '') return null;
  const t = String(v).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[٫,]/g, '.');
  const m = t.match(/\d+(?:\.\d+)?/);
  const n = m ? Number(m[0]) : NaN;
  return Number.isFinite(n) && n >= 0 && n < 1_000_000 ? Math.round(n * 1000) / 1000 : null;
};
const num = parseBhd;

export interface LeadPatch { status?: LeadStatus; valueBhd?: unknown; lostReason?: string | null; followUpDays?: number | null; notes?: string | null; accountId?: string | null; productId?: string | null }
export async function updateLead(id: string, patch: LeadPatch, actor: { sub: string; email: string }, now = new Date()) {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id } });
  const data: Record<string, unknown> = {};
  if (patch.status && patch.status !== lead.status) {
    if (!STATUSES.includes(patch.status)) throw new AppError('BAD_STATUS', 'حالة غير معروفة.', 422);
    data.status = patch.status;
    if (patch.status !== 'NEW' && !lead.firstContactAt) data.firstContactAt = now;
    if (patch.status === 'WON') { data.wonAt = now; data.closedAt = now; data.nextFollowUpAt = null; }
    else if (patch.status === 'LOST') { data.closedAt = now; data.nextFollowUpAt = null; data.lostReason = patch.lostReason?.trim().slice(0, 120) || 'أخرى'; }
    else { data.closedAt = null; data.wonAt = null; const d = FOLLOW_UP_DAYS[patch.status] ?? 2; data.nextFollowUpAt = new Date(now.getTime() + d * DAY); }
  }
  if (patch.valueBhd !== undefined) data.valueBhd = num(patch.valueBhd);
  if (patch.followUpDays != null) data.nextFollowUpAt = new Date(now.getTime() + Math.max(0, Math.min(60, patch.followUpDays)) * DAY);
  if (patch.notes !== undefined) data.notes = patch.notes?.slice(0, 1000) ?? null;
  if (patch.accountId !== undefined) data.accountId = patch.accountId || null;
  if (patch.productId !== undefined) data.productId = patch.productId || null;
  const out = await prisma.lead.update({ where: { id }, data });
  await audit({ actorId: actor.sub, actorLabel: actor.email, action: 'lead.update', targetType: 'lead', targetId: id, details: { from: lead.status, to: out.status, value: out.valueBhd } });
  return out;
}

export interface LeadStats {
  total: number; open: number; won: number; lost: number; revenue: number; conversion: number | null; dueNow: number; slowNew: number;
  medianHoursToContact: number | null; byAccount: { accountId: string | null; name: string; leads: number; won: number; revenue: number }[];
  bySource: { source: string; leads: number; won: number }[]; lostReasons: { reason: string; n: number }[];
}
/** Pure summary of leads created in the period (conversion = won ÷ closed). */
export function summarize(leads: { status: string; source: string; accountId: string | null; valueBhd: number | null; lostReason: string | null; createdAt: Date; firstContactAt: Date | null; nextFollowUpAt: Date | null }[], names: Record<string, string>, now = new Date()): LeadStats {
  const won = leads.filter((l) => l.status === 'WON'), lost = leads.filter((l) => l.status === 'LOST');
  const open = leads.filter((l) => (OPEN as string[]).includes(l.status));
  const hours = leads.filter((l) => l.firstContactAt).map((l) => (l.firstContactAt!.getTime() - l.createdAt.getTime()) / 3600_000).sort((a, b) => a - b);
  const group = <K extends string | null>(key: (l: (typeof leads)[number]) => K) => {
    const m = new Map<K, typeof leads>();
    for (const l of leads) m.set(key(l), [...(m.get(key(l)) ?? []), l]);
    return [...m];
  };
  const reasons = new Map<string, number>();
  for (const l of lost) reasons.set(l.lostReason ?? 'أخرى', (reasons.get(l.lostReason ?? 'أخرى') ?? 0) + 1);
  return {
    total: leads.length, open: open.length, won: won.length, lost: lost.length,
    revenue: Math.round(won.reduce((s, l) => s + (l.valueBhd ?? 0), 0) * 1000) / 1000,
    conversion: won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : null,
    dueNow: open.filter((l) => l.nextFollowUpAt && l.nextFollowUpAt.getTime() <= now.getTime()).length,
    slowNew: open.filter((l) => l.status === 'NEW' && now.getTime() - l.createdAt.getTime() > 2 * 3600_000).length,
    medianHoursToContact: hours.length ? Math.round(hours[Math.floor(hours.length / 2)] * 10) / 10 : null,
    byAccount: group((l) => l.accountId).map(([id, ls]) => ({ accountId: id, name: id ? names[id] ?? '—' : 'غير معروف', leads: ls.length, won: ls.filter((l) => l.status === 'WON').length, revenue: Math.round(ls.filter((l) => l.status === 'WON').reduce((s, l) => s + (l.valueBhd ?? 0), 0) * 1000) / 1000 }))
      .sort((a, b) => b.revenue - a.revenue || b.won - a.won || b.leads - a.leads),
    bySource: group((l) => l.source).map(([source, ls]) => ({ source: source ?? 'other', leads: ls.length, won: ls.filter((l) => l.status === 'WON').length })).sort((a, b) => b.leads - a.leads),
    lostReasons: [...reasons].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n),
  };
}

export async function leadStats(days = 30, now = new Date()) {
  const since = new Date(now.getTime() - days * DAY);
  const [leads, accounts] = await Promise.all([
    prisma.lead.findMany({ where: { createdAt: { gte: since } }, select: { status: true, source: true, accountId: true, valueBhd: true, lostReason: true, createdAt: true, firstContactAt: true, nextFollowUpAt: true } }),
    prisma.socialAccount.findMany({ select: { id: true, name: true } }),
  ]);
  return summarize(leads, Object.fromEntries(accounts.map((a) => [a.id, a.name])), now);
}

/** Daily: one reminder listing the customers due for a follow-up (and new ones waiting > 2 h). */
export async function followUpReminder(now = new Date()) {
  await leadsFromComments();
  const due = await prisma.lead.findMany({ where: { status: { in: OPEN }, nextFollowUpAt: { lte: now } }, orderBy: { nextFollowUpAt: 'asc' }, take: 50, include: { account: { select: { name: true } } } });
  const ov = await salesOverview(now).catch(() => null);
  if (!due.length && !ov?.reactivate.length) return { due: 0 };
  if (!due.length && ov) {
    if (now.getUTCDay() !== 0) return { due: 0 }; // past-customer note alone: once a week (Sunday)
    await notify('INFO', 'LEADS_REACTIVATE', `${ov.reactivate.length} عميل سابق جاهز لعرض جديد`, 'عملاء طلبوا منك قبل فترة ولم يعودوا — رسالة «عميل سابق» جاهزة لهم في «العملاء والطلبات».');
    return { due: 0, reactivate: ov.reactivate.length };
  }
  const lines = due.slice(0, 12).map((l) => `• ${l.name ?? l.contact ?? 'عميل'} (${STATUS_AR[l.status as LeadStatus]}${l.account ? ` · ${l.account.name}` : ''}): ${l.need.slice(0, 60)}`);
  await notify('WARNING', 'LEADS_FOLLOW_UP', `${due.length} عميل بانتظار متابعتك اليوم`, `${lines.join('\n')}${due.length > 12 ? `\n… و${due.length - 12} آخرين` : ''}${ov?.pipeline.expiringSoon ? `\n⏳ ${ov.pipeline.expiringSoon} عرض سعر ينتهي خلال يومين.` : ''}${ov?.reactivate.length ? `\n🔁 ${ov.reactivate.length} عميل سابق جاهز لعرض جديد.` : ''}\n\nالرد السريع يضاعف فرصة الطلب — افتح «العملاء والطلبات».`);
  return { due: due.length };
}

// ───────────────────────── «المبيعات»: scripts sent, quotes, target, reactivation ─────────────────────────

const NEXT_AFTER: Partial<Record<ScriptKey, number>> = { first_reply: 2, quote_send: 2, follow_1: 3, follow_2: 3 };
/** A person sent a playbook message from WhatsApp — logged, and the pipeline advances accordingly. */
export async function recordTouch(id: string, key: ScriptKey, actor: { sub: string; email: string }, now = new Date()) {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id } });
  const touches = [...((lead.touches as unknown as Touch[] | null) ?? []), { key, at: now.toISOString(), by: actor.email }].slice(-50);
  const data: Record<string, unknown> = { touches: touches as unknown as Prisma.InputJsonValue };
  const open = ['NEW', 'CONTACTED', 'QUOTED'].includes(lead.status);
  if (!lead.firstContactAt) data.firstContactAt = now;
  if (key === 'first_reply' && lead.status === 'NEW') data.status = 'CONTACTED';
  if (key === 'quote_send' && open) data.status = 'QUOTED';
  if (open && NEXT_AFTER[key]) data.nextFollowUpAt = new Date(now.getTime() + NEXT_AFTER[key]! * DAY);
  if (key === 'follow_2') data.nextFollowUpAt = new Date(now.getTime() + 3 * DAY);
  const out = await prisma.lead.update({ where: { id }, data });
  await audit({ actorId: actor.sub, actorLabel: actor.email, action: 'lead.touch', targetType: 'lead', targetId: id, details: { key } });
  return out;
}

export interface QuoteInput { items: QuoteItem[]; discount?: number; notes?: string }
/** Saves the quote the owner typed (prices are never suggested by the system); numbers quotes sequentially. */
export async function saveQuote(id: string, input: QuoteInput, actor: { sub: string; email: string }, now = new Date()) {
  const items = input.items.map((i) => ({ desc: i.desc.trim().slice(0, 120), qty: Math.round(i.qty), unit: Math.round(i.unit * 1000) / 1000 })).filter((i) => i.desc && i.qty > 0 && i.unit >= 0);
  if (!items.length) throw new AppError('EMPTY_QUOTE', 'أضف بندًا واحدًا على الأقل بكمية وسعر.', 422);
  const s = await getSettings();
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id } });
  const prev = lead.quote as unknown as Quote | null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const no = lead.quoteNo ?? ((await prisma.lead.aggregate({ _max: { quoteNo: true } }))._max.quoteNo ?? 1000) + 1;
    const quote: Quote = { no, items, discount: Math.max(0, input.discount ?? 0), notes: (input.notes ?? '').slice(0, 500), validUntil: new Date(now.getTime() + s.sales.quoteValidityDays * DAY).toISOString(), at: now.toISOString() };
    const t = quoteTotals(quote);
    try {
      const out = await prisma.lead.update({ where: { id }, data: {
        quote: quote as unknown as Prisma.InputJsonValue, quoteNo: no, valueBhd: t.total,
        ...(['NEW', 'CONTACTED'].includes(lead.status) ? { status: 'QUOTED', firstContactAt: lead.firstContactAt ?? now, nextFollowUpAt: now } : {}),
      } });
      await audit({ actorId: actor.sub, actorLabel: actor.email, action: prev ? 'lead.quote.update' : 'lead.quote.create', targetType: 'lead', targetId: id, details: { no, total: t.total, items: items.length } });
      return out;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && !lead.quoteNo) continue; // two quotes numbered at once — take the next
      throw e;
    }
  }
  throw new AppError('CONFLICT', 'تعذّر ترقيم العرض — حاول مرة أخرى.', 409);
}

export interface SalesOverview {
  month: { revenue: number; won: number; target: number; pct: number | null; pacePct: number; expectedByNow: number };
  pipeline: { quotes: number; value: number; expiringSoon: number };
  reactivate: { id: string; name: string | null; contact: string | null; need: string; wonAt: Date | null; valueBhd: number | null; account: string | null }[];
}
/** Month-to-date sales vs target, open-quote pipeline, and past customers due for a new offer. */
export async function salesOverview(now = new Date()): Promise<SalesOverview> {
  const s = await getSettings();
  const tz = 'Asia/Bahrain';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map((p) => [p.type, p.value]));
  const monthStart = new Date(`${parts.year}-${parts.month}-01T00:00:00+03:00`);
  const daysInMonth = new Date(Number(parts.year), Number(parts.month), 0).getDate();
  const [won, quoted, past] = await Promise.all([
    prisma.lead.findMany({ where: { status: 'WON', wonAt: { gte: monthStart } }, select: { valueBhd: true } }),
    prisma.lead.findMany({ where: { status: 'QUOTED' }, select: { valueBhd: true, quote: true } }),
    prisma.lead.findMany({ where: { status: 'WON', wonAt: { lte: new Date(now.getTime() - s.sales.reactivationDays * DAY) } }, orderBy: { wonAt: 'asc' }, take: 200, include: { account: { select: { name: true } } } }),
  ]);
  const revenue = Math.round(won.reduce((a, l) => a + (l.valueBhd ?? 0), 0) * 1000) / 1000;
  const pacePct = Math.round((Number(parts.day) / daysInMonth) * 100);
  const target = s.sales.monthlyTargetBhd;
  const recent = (t: Touch[] | null) => (t ?? []).some((x) => x.key === 'reactivate' && now.getTime() - new Date(x.at).getTime() < s.sales.reactivationDays * DAY);
  // a customer who already came back (newer lead with the same contact) is not chased again
  const contacts = past.map((l) => l.contact).filter((c): c is string => !!c);
  const newer = contacts.length ? await prisma.lead.findMany({ where: { contact: { in: contacts } }, select: { id: true, contact: true, createdAt: true } }) : [];
  return {
    month: { revenue, won: won.length, target, pct: target ? Math.round((revenue / target) * 100) : null, pacePct, expectedByNow: Math.round(target * (pacePct / 100)) },
    pipeline: {
      quotes: quoted.length, value: Math.round(quoted.reduce((a, l) => a + (l.valueBhd ?? 0), 0) * 1000) / 1000,
      expiringSoon: quoted.filter((l) => { const q = l.quote as unknown as Quote | null; if (!q) return false; const left = new Date(q.validUntil).getTime() - now.getTime(); return left > 0 && left < 2 * DAY; }).length,
    },
    reactivate: past.filter((l) => !recent(l.touches as unknown as Touch[] | null) && !newer.some((n) => n.id !== l.id && n.contact === l.contact && n.createdAt > (l.wonAt ?? l.createdAt)))
      .slice(0, 30).map((l) => ({ id: l.id, name: l.name, contact: l.contact, need: l.need, wonAt: l.wonAt, valueBhd: l.valueBhd, account: l.account?.name ?? null })),
  };
}
