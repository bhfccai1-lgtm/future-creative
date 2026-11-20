import { prisma } from '../db';
import { AppError } from '../errors';
import { getSettings } from '../settings';
import { getAiProvider } from '../ai';
import { assertBudget, estimateTextCost, recordUsage } from '../ai/cost';
import { contactLines, getBusiness } from '../business';
import { quoteTotals, scriptText, waNumber, nextAction, type Quote, type Touch } from './scripts';

/**
 * «العميل الذكي» — sales intelligence on top of the leads pipeline (no new tables, no AI cost except the
 * on-demand reply):
 *  - CUSTOMER PROFILE: every request of the same WhatsApp/phone number is one customer — orders, lifetime value,
 *    last order, lost deals. Repeat customers are recognised the moment they write again.
 *  - LEAD SCORE (0–100, hot / warm / cold) from real signals, each one explained: urgency or a date in the
 *    request, a large quantity or a business buyer, a sent quote, a repeat customer, how fresh the request is.
 *  - TODAY: the open requests to contact first (score + overdue follow-up), so nothing hot goes cold.
 *  - SMART REPLY: one small AI text call writes the next WhatsApp message from the customer's own words and
 *    history (Gulf Arabic, no invented prices); without an AI key the ready script is used.
 */
export type Tier = 'hot' | 'warm' | 'cold';
export const TIER_AR: Record<Tier, string> = { hot: '🔥 ساخن', warm: '🌤️ دافئ', cold: '❄️ بارد' };

export interface CustomerProfile { key: string; requests: number; won: number; lost: number; lifetimeBhd: number; lastWonAt: Date | null; firstSeen: Date }
export interface LeadScore { score: number; tier: Tier; reasons: string[] }

type ScoredLead = { status: string; source: string; need: string; notes?: string | null; valueBhd?: number | null; createdAt: Date; quote?: unknown };

const URGENT = /(اليوم|الحين|بكرة|باجر|بكره|ضروري|مستعجل|عاجل|هالأسبوع|هذا الأسبوع|قبل (?:الخميس|الجمعة|السبت|العيد|المناسبة)|urgent|asap|today|tomorrow)/i;
const DATE = /(\d{1,2}\s*[/-]\s*\d{1,2})|(يوم\s+(?:الأحد|الاثنين|الثلاثاء|الأربعاء|الخميس|الجمعة|السبت))|(بعد\s+(?:يوم|يومين|أسبوع))/;
const BULK = /(كمية|بالجملة|جملة|شركة|مؤسسة|مدرسة|وزارة|فعالية|مؤتمر|حفل|عرس|زواج|تخرج|موظف|bulk|company|school|event|wedding)/i;
const UNITS = 'حبة|حبه|حبات|قطعة|قطعه|قطع|كوب|أكواب|اكواب|تيشيرت|تيشرت|قميص|نسخة|نسخ|كرت|كروت|بطاقة|بطاقات|ملصق|ملصقات|ستيكر|ستيكرات|علبة|كيس|أكياس|pcs|pieces|units|cups|cards';
/** a number counts as a QUANTITY only next to a unit («150 كوب») or after «ابي/عدد/كمية» — not a size or a price («850 فلس», «85×200») */
const QTY = new RegExp(`(?:(?:ابي|أبي|ابغى|أبغى|نبي|نبغى|عدد|كمية)\\s*(\\d{2,5}))|(?:(\\d{2,5})\\s*(?:${UNITS}))`, 'i');
const qtyOf = (t: string) => { const m = QTY.exec(t); return Number(m?.[1] ?? m?.[2] ?? 0); };
const ASK_PRICE = /(كم السعر|بكم|السعر|سعر|price|how much)/i;

export const customerKey = (contact: string | null | undefined) => waNumber(contact) ?? (contact?.trim().toLowerCase() || null);

/** pure: the score of one request (exported for tests) */
export function scoreLead(l: ScoredLead, profile: CustomerProfile | null, now = new Date()): LeadScore {
  let s = 30; const why: string[] = [];
  const text = `${l.need} ${l.notes ?? ''}`;
  if (URGENT.test(text)) { s += 22; why.push('يريدها بسرعة'); }
  else if (DATE.test(text)) { s += 12; why.push('ذكر موعدًا'); }
  const qty = qtyOf(text);
  if (qty >= 20 && qty < 100000) { s += 14; why.push(`كمية ${qty}`); }
  else if (BULK.test(text)) { s += 12; why.push('جهة أو مناسبة (طلب كبير محتمل)'); }
  if (ASK_PRICE.test(text) && l.status === 'NEW') { s += 5; why.push('سأل عن السعر'); }
  if (l.status === 'QUOTED') { s += 14; why.push('استلم عرض سعر'); }
  else if (l.status === 'CONTACTED') { s += 5; }
  if (profile && profile.won > 0) { s += 18; why.push(`عميل سابق (${profile.won} طلب)`); }
  else if (profile && profile.lost > 0 && profile.won === 0) { s -= 6; why.push('لم يكمل طلبًا سابقًا'); }
  const value = l.valueBhd ?? (l.quote ? quoteTotals(l.quote as Quote).total : 0);
  if (value >= 50) { s += 8; why.push(`قيمة ${Math.round(value)} د.ب`); }
  if (['whatsapp', 'phone', 'walkin'].includes(l.source)) { s += 5; }
  const ageDays = (now.getTime() - l.createdAt.getTime()) / 86400_000;
  if (ageDays < 1) { s += 10; why.push('طلب جديد اليوم'); }
  else if (ageDays > 14) { s -= 15; why.push(`مضى ${Math.round(ageDays)} يومًا`); }
  else if (ageDays > 7) { s -= 7; }
  const score = Math.max(0, Math.min(100, Math.round(s)));
  return { score, tier: score >= 60 ? 'hot' : score >= 38 ? 'warm' : 'cold', reasons: why.slice(0, 4) };
}

/** profiles of the given contacts, from every request they ever made */
export async function customerProfiles(contacts: (string | null)[]): Promise<Map<string, CustomerProfile>> {
  const keys = new Set(contacts.map(customerKey).filter((k): k is string => !!k));
  const out = new Map<string, CustomerProfile>();
  if (!keys.size) return out;
  // a contact is stored as typed («+973 3331 6319», «٣٣٣١٦٣١٩»…) — compare the digits only (parameterised), then group
  const tails = [...new Set([...keys].map((k) => k.replace(/\D/g, '').slice(-8)).filter((t) => t.length >= 6))].map((t) => `%${t}`);
  const exact = [...keys];
  const rows = await prisma.$queryRaw<{ contact: string | null; status: string; valueBhd: number | null; wonAt: Date | null; createdAt: Date }[]>`
    SELECT "contact", "status", "valueBhd", "wonAt", "createdAt" FROM "leads"
    WHERE regexp_replace(translate(coalesce("contact", ''), '٠١٢٣٤٥٦٧٨٩', '0123456789'), '[^0-9]', '', 'g') LIKE ANY(${tails.length ? tails : ['%-none-']})
       OR lower(trim(coalesce("contact", ''))) = ANY(${exact})
    LIMIT 5000`;
  for (const r of rows) {
    const k = customerKey(r.contact);
    if (!k || !keys.has(k)) continue;
    const p = out.get(k) ?? { key: k, requests: 0, won: 0, lost: 0, lifetimeBhd: 0, lastWonAt: null, firstSeen: r.createdAt };
    p.requests++;
    if (r.status === 'WON') { p.won++; p.lifetimeBhd += r.valueBhd ?? 0; if (r.wonAt && (!p.lastWonAt || r.wonAt > p.lastWonAt)) p.lastWonAt = r.wonAt; }
    if (r.status === 'LOST') p.lost++;
    if (r.createdAt < p.firstSeen) p.firstSeen = r.createdAt;
    out.set(k, p);
  }
  return out;
}

/** the profile without the request itself (a first request must not count as «repeat customer») */
export function priorProfile(p: CustomerProfile | undefined, l: { status: string; valueBhd?: number | null }): CustomerProfile | null {
  if (!p) return null;
  const won = p.won - (l.status === 'WON' ? 1 : 0), lost = p.lost - (l.status === 'LOST' ? 1 : 0);
  return { ...p, requests: p.requests - 1, won, lost, lifetimeBhd: p.lifetimeBhd - (l.status === 'WON' ? l.valueBhd ?? 0 : 0) };
}

/** the open requests to contact first today: score, plus a push for overdue follow-ups */
export async function todayPriorities(now = new Date(), limit = 6) {
  const open = await prisma.lead.findMany({ where: { status: { in: ['NEW', 'CONTACTED', 'QUOTED'] } }, orderBy: { createdAt: 'desc' }, take: 300 });
  const profiles = await customerProfiles(open.map((l) => l.contact));
  return open.map((l) => {
    const sc = scoreLead(l, priorProfile(profiles.get(customerKey(l.contact) ?? ''), l), now);
    const overdueH = l.nextFollowUpAt ? (now.getTime() - l.nextFollowUpAt.getTime()) / 3600_000 : 0;
    const priority = sc.score + (overdueH > 0 ? 15 + Math.min(20, overdueH / 6) : 0);
    return { id: l.id, name: l.name ?? l.contact ?? 'عميل', need: l.need, status: l.status, ...sc, overdue: overdueH > 0, priority };
  }).sort((a, b) => b.priority - a.priority).slice(0, limit);
}

/** ✨ the next WhatsApp message written for THIS customer (one small AI call; the ready script without a key) */
export async function smartReply(id: string): Promise<{ text: string; source: 'ai' | 'script' }> {
  const l = await prisma.lead.findUnique({ where: { id }, include: { product: { select: { titleAr: true } } } });
  if (!l) throw new AppError('NOT_FOUND', 'العميل غير موجود', 404);
  const s = await getSettings(), business = await getBusiness();
  const ctx = { business: business.nameAr, branches: contactLines(business, 'ar'), reactivationDays: s.sales.reactivationDays };
  const lk = { ...l, quote: l.quote as unknown as Quote | null, touches: l.touches as unknown as Touch[] | null };
  const step = nextAction(lk, ctx);
  const fallback = { text: scriptText(step?.key ?? 'first_reply', lk, ctx), source: 'script' as const };
  const provider = await getAiProvider(s).catch(() => null);
  if (!provider || provider.isDryRun || !provider.generateJson) return fallback;
  const profile = priorProfile((await customerProfiles([l.contact])).get(customerKey(l.contact) ?? ''), l);
  const total = lk.quote ? quoteTotals(lk.quote).total : null;
  await assertBudget(s, estimateTextCost(s, 1200, 300));
  try {
    const r = await provider.generateJson([
      `You write WhatsApp messages for ${business.nameAr}, a print & gift shop in Bahrain (branches: ${ctx.branches.map((b) => `${b.label} ${b.phone}`).join(', ')}).`,
      'Write the NEXT message to this customer in warm, short Gulf/Bahraini Arabic (max 5 short lines), answering what they actually asked, and end with one clear next step (confirm the design, the quantity, a delivery date, or a visit).',
      'NEVER invent prices, discounts, delivery times or stock — use only the facts given; if a price is needed and no quote total is given, say the quote will follow. No hashtags. At most one emoji.',
      'Return JSON {"text":"..."}.',
    ].join('\n'), JSON.stringify({
      customer: l.name, request: l.need, conversation: (l.notes ?? '').slice(-1200), status: l.status, product: l.product?.titleAr ?? null,
      quoteTotalBhd: total, quoteNo: l.quoteNo, step: step?.label ?? null,
      history: profile && profile.requests > 0 ? { previousRequests: profile.requests, previousOrders: profile.won, lastOrder: profile.lastWonAt?.toISOString().slice(0, 10) ?? null } : null,
    }), s.ai.textModel);
    await recordUsage({ provider: provider.name, model: r.model, kind: 'text', inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, costUsd: estimateTextCost(s, r.usage.inputTokens, r.usage.outputTokens) });
    const text = String((r.json as { text?: unknown })?.text ?? '').trim().slice(0, 900);
    return text.length >= 10 ? { text, source: 'ai' } : fallback;
  } catch { return fallback; }
}
