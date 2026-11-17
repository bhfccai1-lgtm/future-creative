/**
 * Comment triage rules (work without AI and validate AI output): category, sentiment, urgency, language,
 * and a safe Bahraini-Arabic reply template. Replies never contain prices, discounts, delivery promises or
 * unverified claims; the only numbers allowed are the official branch phones.
 */
export type CommentCategory = 'order' | 'price' | 'info' | 'praise' | 'complaint' | 'spam' | 'other';
export const CATEGORY_AR: Record<CommentCategory, string> = { order: 'طلب / شراء', price: 'سؤال عن السعر', info: 'استفسار', praise: 'مدح', complaint: 'شكوى', spam: 'إزعاج / سبام', other: 'أخرى' };
export const URGENT: CommentCategory[] = ['order', 'price', 'complaint'];

const RX: [CommentCategory, RegExp][] = [
  ['spam', /(https?:\/\/|www\.|bit\.ly|follow\s*(me|back)|dm\s*(me|for)|check\s*(my|out)|promo(tion)?\s*(code|page)|crypto|bitcoin|forex|earn\s*\$|💸{2,}|تابعني|ربح\s*مضمون|استثمار\s*مضمون)/i],
  ['complaint', /(سيء|سيئ|زفت|تأخر|متأخر|تأخير|خربان|ما\s*وصل|ماوصل|غلط|مشكل|ما\s*عجب|ماعجب|نصب|ضعيف|خايس|كذب|bad|late|worst|disappoint|terrible|scam|broken|wrong|refund|😡|😠|👎)/i],
  ['price', /(سعر|اسعار|أسعار|بكم|بچم|كم\s*(السعر|سعر|الحبة|القطعة|يكلف)|تكلف|price|how\s*much|cost|rate|💰|💲)/i],
  ['order', /(أبي|ابي|أبا|ابا|أبغى|ابغى|ابغي|نبي|اطلب|أطلب|طلب|اوصي|أوصي|حجز|احجز|متوفر|متوفره|موجود\s*عندكم|توصيل|كم\s*يوم|يحتاج\s*وقت|order|i\s*want|i\s*need|available|delivery|book)/i],
  ['info', /(كيف|وين|وينكم|موقع|لوكيشن|مكان|عنوان|دوام|متى|ممكن|هل|تسوون|تطبعون|عندكم|رقم|واتس|location|where|address|hours|open|can\s*you|do\s*you|\?|؟)/i],
  ['praise', /(حلو|حلوة|روعة|رائع|جميل|يجنن|يهبل|ماشاءالله|ما\s*شاء\s*الله|تبارك|مبدع|ابداع|إبداع|احسنتم|أحسنتم|عاشت\s*ايدكم|تسلم|يعطيكم|❤|❤️|😍|🔥|👏|💯|🌹|nice|beautiful|amazing|love|great|perfect|wow|awesome|cute|gorgeous)/i],
];

export function detectLanguage(t: string): 'ar' | 'en' | 'ml' | 'other' {
  if (/[ഀ-ൿ]/.test(t)) return 'ml';
  if (/[؀-ۿ]/.test(t)) return 'ar';
  if (/[a-z]/i.test(t)) return 'en';
  return 'other';
}

export function classifyComment(text: string): { category: CommentCategory; sentiment: 'positive' | 'neutral' | 'negative'; urgent: boolean; language: ReturnType<typeof detectLanguage> } {
  const t = text.trim();
  let category: CommentCategory = 'other';
  for (const [c, rx] of RX) if (rx.test(t)) { category = c; break; }
  // an emoji-only comment with no hearts/fire is just a reaction
  const sentiment = category === 'complaint' ? 'negative' : category === 'praise' ? 'positive' : 'neutral';
  return { category, sentiment, urgent: URGENT.includes(category), language: detectLanguage(t) };
}

export interface ReplyCtx { username?: string | null; phones: { label: string; phone: string }[]; cta: string; whatsapp?: string | null }

/** Safe, warm reply template per category (Bahraini Arabic / English). Empty for spam (hide it instead). */
export function templateReply(category: CommentCategory, lang: string, c: ReplyCtx): string {
  const at = c.username ? `@${c.username.replace(/^@/, '')} ` : '';
  const phonesAr = c.phones.map((p) => `${p.label} ${p.phone}`).join(' · ');
  const phonesEn = c.phones.map((p) => `${p.label.replace(/^فرع\s*/, '')} ${p.phone}`).join(' · ');
  if (category === 'spam') return '';
  if (lang !== 'ar') {
    const m: Record<Exclude<CommentCategory, 'spam'>, string> = {
      order: `Hi ${at}🌷 we'd love to make it for you! Message us on WhatsApp or call: ${phonesEn}`,
      price: `Hi ${at}🌷 prices depend on size and quantity — message us on WhatsApp or call ${phonesEn} and we'll send you all the details.`,
      info: `Hi ${at}sure! Reach us on WhatsApp or call ${phonesEn} and we'll answer right away 🌷`,
      praise: `Thank you ${at}🙏 that means a lot to us! 💛`,
      complaint: `We're sorry ${at}🙏 we'd like to fix this quickly — please send us a DM or call ${phonesEn}.`,
      other: `Thanks for your comment ${at}🌷`,
    };
    return m[category];
  }
  const m: Record<Exclude<CommentCategory, 'spam'>, string> = {
    order: `هلا ${at}🌷 يسعدنا نخدمك! راسلنا على الواتساب أو كلّمنا: ${phonesAr} ونجهّز لك طلبك.`,
    price: `هلا ${at}🌷 السعر يعتمد على المقاس والكمية — راسلنا على الواتساب أو كلّمنا: ${phonesAr} ونعطيك كل التفاصيل.`,
    info: `هلا ${at}أكيد! تواصل معنا على الواتساب أو كلّمنا: ${phonesAr} ونرد عليك على طول 🌷`,
    praise: `تسلم ${at}🙏 كلامك يفرحنا وننتظرك دايمًا 💛`,
    complaint: `نعتذر لك ${at}🙏 ونبي نحل الموضوع بسرعة — راسلنا خاص أو كلّمنا: ${phonesAr}`,
    other: `شكرًا ${at}على تفاعلك 🌷`,
  };
  return m[category];
}

const FORBIDDEN = /(\d+\s*(%|bd|bhd|د\.?\s?ب|دينار|ريال|sar|fils|فلس)|خصم|تخفيض|مجان|ببلاش|free\b|discount|sale\b|أرخص|ارخص|الأفضل|رقم\s*1|best\b|cheapest|guarantee|نضمن|مضمون|خلال\s*\d+\s*(ساع|يوم|أيام)|within\s*\d+\s*(hour|day))/i;

/** Problems that make a reply unsafe to send (forbidden claims, unofficial numbers, too long). */
export function replyIssues(reply: string, allowedPhones: string[]): string[] {
  const out: string[] = [];
  if (!reply.trim()) out.push('الرد فارغ');
  if (reply.length > 600) out.push('الرد أطول من 600 حرف');
  if (FORBIDDEN.test(reply)) out.push('يحتوي سعرًا أو خصمًا أو وعدًا أو ادعاءً ممنوعًا');
  for (const n of reply.match(/\d[\d\s-]{5,}\d/g) ?? []) if (!allowedPhones.includes(n.replace(/[\s-]/g, ''))) out.push(`رقم غير رسمي: ${n}`);
  if (/https?:\/\//i.test(reply)) out.push('يحتوي رابطًا');
  return out;
}

/** Pasted comments → rows. Accepts «username: text», «@username text» or plain lines. */
export function parsePasted(blob: string): { username: string | null; text: string }[] {
  return blob.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length >= 2).slice(0, 300).map((l) => {
    const m = l.match(/^@?([A-Za-z0-9._]{2,30})\s*[:：]\s*(.+)$/) ?? l.match(/^@([A-Za-z0-9._]{2,30})\s+(.+)$/);
    return m ? { username: m[1], text: m[2].trim().slice(0, 2000) } : { username: null, text: l.slice(0, 2000) };
  });
}
