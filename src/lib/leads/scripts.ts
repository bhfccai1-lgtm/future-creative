/**
 * Sales playbook (pure): the right WhatsApp message for each stage of a customer, written in polite Bahraini Arabic
 * (English when the customer wrote in English). Rules: no invented prices, discounts, deadlines or pressure tactics —
 * prices appear only from a quote the owner typed. A person always presses «send» in WhatsApp.
 */
export type ScriptKey = 'first_reply' | 'quote_send' | 'follow_1' | 'follow_2' | 'won_thanks' | 'reactivate' | 'reengage';
export const SCRIPT_AR: Record<ScriptKey, string> = {
  first_reply: 'الرد الأول وأسئلة التفاصيل', quote_send: 'إرسال عرض السعر', follow_1: 'متابعة العرض (اليوم 2)', follow_2: 'متابعة أخيرة (اليوم 5)',
  won_thanks: 'شكر بعد الطلب + طلب رأيه', reactivate: 'عميل سابق — طلب جديد', reengage: 'إعادة التواصل بعد عدم الاكتمال',
};

export interface LeadLike {
  name: string | null; contact: string | null; need: string; status: string; source?: string;
  createdAt: Date; firstContactAt?: Date | null; wonAt?: Date | null; closedAt?: Date | null; lostReason?: string | null;
  quote?: Quote | null; touches?: Touch[] | null;
}
export interface QuoteItem { desc: string; qty: number; unit: number }
export interface Quote { no: number; items: QuoteItem[]; discount: number; notes: string; validUntil: string; at: string }
export interface Touch { key: ScriptKey; at: string; by: string }
export interface Ctx { business: string; branches: { label: string; phone: string }[]; reactivationDays: number }

const DAY = 86400_000;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
export const quoteTotals = (q: Pick<Quote, 'items' | 'discount'>) => {
  const subtotal = r3(q.items.reduce((s, i) => s + i.qty * i.unit, 0));
  const discount = r3(Math.min(Math.max(0, q.discount || 0), subtotal));
  return { subtotal, discount, total: r3(subtotal - discount) };
};
export const bhd = (n: number) => `${n.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} د.ب`;
const isEn = (l: LeadLike) => !/[؀-ۿ]/.test(l.need) && /[a-z]/i.test(l.need);
/** «أم محمد» / «بو علي» stay whole; otherwise the first name; handles lose the @; numbers are not names. */
const firstName = (l: LeadLike) => {
  const n = (l.name ?? '').replace(/^@/, '').trim();
  if (!n || /^[\d+\s]+$/.test(n)) return '';
  const w = n.split(/\s+/);
  return /^(أم|ام|أبو|ابو|بو)$/.test(w[0]) && w[1] ? `${w[0]} ${w[1]}` : w[0];
};
const short = (t: string, n = 70) => (t.length > n ? `${t.slice(0, n).trim()}…` : t);
const dateAr = (iso: string) => new Intl.DateTimeFormat('ar-BH-u-nu-latn', { timeZone: 'Asia/Bahrain', day: 'numeric', month: 'long' }).format(new Date(iso));
const dateEn = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bahrain', day: 'numeric', month: 'long' }).format(new Date(iso));

/** WhatsApp number from what the customer gave: Bahrain 8-digit → 973…, international digits kept; else null. */
export function waNumber(contact: string | null | undefined): string | null {
  if (!contact) return null;
  let d = contact.replace(/[٠-٩]/g, (x) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(x))).replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1); else if (d.startsWith('00')) d = d.slice(2);
  if (/^[3678]\d{7}$/.test(d)) return `973${d}`;
  return /^\d{10,15}$/.test(d) ? d : null;
}
export const waLink = (contact: string | null | undefined, text: string) => { const n = waNumber(contact); return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null; };

export function scriptText(key: ScriptKey, l: LeadLike, c: Ctx): string {
  const en = isEn(l), nm = firstName(l), need = short(l.need);
  const phones = c.branches.map((b) => `${b.label} ${b.phone}`).join(' · ');
  const q = l.quote, t = q ? quoteTotals(q) : null;
  if (en) {
    const hi = nm ? `Hi ${nm}` : 'Hi';
    switch (key) {
      case 'first_reply': return `${hi}, thank you for contacting ${c.business} 🌟\nAbout "${need}": to give you the best offer, could you share the quantity, size and the date you need it by?`;
      case 'quote_send': return `${hi}, here is your quote${q ? ` #${q.no}` : ''} for "${need}":\n${q ? q.items.map((i) => `• ${i.desc} × ${i.qty}`).join('\n') : ''}${t ? `\nTotal: ${t.total.toFixed(3)} BHD` : ''}${q ? `\nValid until ${dateEn(q.validUntil)}.` : ''}\nHappy to adjust quantity or material if needed.`;
      case 'follow_1': return `${hi}, just checking you received our quote for "${need}". If you'd like a different quantity or finish, we can prepare it for you.`;
      case 'follow_2': return `${hi}, a gentle last reminder about "${need}"${q ? ` — the quote is valid until ${dateEn(q.validUntil)}` : ''}. If you have an event date, let us know so we can plan delivery on time.`;
      case 'won_thanks': return `${hi}, thank you for your order 🙏 When you receive it, we'd love to hear your feedback or see a photo.`;
      case 'reactivate': return `${hi}, we hope you liked your previous order ("${need}"). If you have an upcoming occasion or event, we'll be glad to prepare it with the same quality.\n${phones}`;
      case 'reengage': return `${hi}, we'd still love to help with "${need}". We have options in different quantities and materials to suit your budget — just tell us what works for you.`;
    }
  }
  const hi = nm ? `هلا ${nm}` : 'هلا وغلا';
  switch (key) {
    case 'first_reply': return `${hi}، شكرًا لتواصلك مع ${c.business} 🌟\nبخصوص «${need}»: عشان نعطيك أفضل عرض، ممكن تقول لنا الكمية والمقاس والموعد اللي تحتاجه فيه؟`;
    case 'quote_send': return `${hi}، تفضل عرض السعر${q ? ` رقم ${q.no}` : ''} لـ «${need}»:\n${q ? q.items.map((i) => `• ${i.desc} × ${i.qty}`).join('\n') : ''}${t ? `\nالإجمالي: ${bhd(t.total)}` : ''}${q ? `\nالعرض صالح لين ${dateAr(q.validUntil)}.` : ''}\nإذا تبي نعدّل الكمية أو الخامة نرتبها لك.`;
    case 'follow_1': return `${hi}، حبيت أتأكد وصلك عرض السعر بخصوص «${need}». إذا تبي كمية ثانية أو تشطيب مختلف نجهزه لك.`;
    case 'follow_2': return `${hi}، تذكير أخير لطيف بخصوص «${need}»${q ? ` — العرض صالح لين ${dateAr(q.validUntil)}` : ''}. إذا عندك موعد فعالية أو مناسبة خبرنا عشان نضمن التسليم في وقته.`;
    case 'won_thanks': return `${hi}، شكرًا على ثقتك وطلبك 🙏 لما تستلم الطلب يسعدنا نسمع رأيك أو تشاركنا صورة.`;
    case 'reactivate': return `${hi}، إن شاء الله الطلب السابق («${need}») عجبك. إذا عندك مناسبة أو فعالية قادمة نجهزها لك بنفس الجودة.\n${phones}`;
    case 'reengage': return `${hi}، نتمنى نساعدك في «${need}». عندنا خيارات بكميات وخامات مختلفة تناسب ميزانيتك — خبرنا وش يناسبك.`;
  }
}

const touched = (l: LeadLike, key: ScriptKey) => (l.touches ?? []).some((t) => t.key === key);
const lastTouch = (l: LeadLike, key: ScriptKey) => (l.touches ?? []).filter((t) => t.key === key).map((t) => new Date(t.at).getTime()).sort((a, b) => b - a)[0] ?? 0;

/** The single next best sales action for a customer (null = nothing to do now). */
export function nextAction(l: LeadLike, c: Ctx, now = new Date()): { key: ScriptKey; due: boolean; label: string } | null {
  const t = now.getTime();
  const since = (d?: Date | string | null) => (d ? (t - new Date(d).getTime()) / DAY : 0);
  const out = (key: ScriptKey, due = true) => ({ key, due, label: SCRIPT_AR[key] });
  switch (l.status) {
    case 'NEW': return out('first_reply');
    case 'CONTACTED': return l.quote && !touched(l, 'quote_send') ? out('quote_send') : null;
    case 'QUOTED': {
      if (l.quote && !touched(l, 'quote_send')) return out('quote_send');
      const sent = lastTouch(l, 'quote_send') || (l.quote ? new Date(l.quote.at).getTime() : 0);
      const d = sent ? (t - sent) / DAY : 0;
      if (!touched(l, 'follow_1')) return out('follow_1', d >= 2);
      if (!touched(l, 'follow_2')) return out('follow_2', d >= 5);
      return null;
    }
    case 'WON':
      if (!touched(l, 'won_thanks')) return out('won_thanks');
      if (since(l.wonAt) >= c.reactivationDays && since(new Date(lastTouch(l, 'reactivate') || 0)) >= c.reactivationDays) return out('reactivate');
      return null;
    case 'LOST':
      if (since(l.closedAt) >= 30 && !touched(l, 'reengage') && l.lostReason !== 'لم يرد') return out('reengage');
      return null;
  }
  return null;
}
