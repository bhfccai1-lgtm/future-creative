/**
 * The owner's rule for ad ideas: no prices, discounts or delivery times (they change and must never be promised by a
 * design). Checked live while the idea is typed — a warning, the server-side copy rules still apply.
 */
const RULES: { re: RegExp; msg: string }[] = [
  { re: /\d[\d.,]*\s*(د\.?\s?ب|دينار|فلس|ريال|درهم|bd|bhd|sar|aed|usd|\$)|(د\.?\s?ب|دينار|bd|bhd|\$)\s*\d/i, msg: 'تحتوي الفكرة على سعر — الأسعار لا تُذكر في التصميم' },
  { re: /خصم|تخفيض|تخفيضات|تنزيلات|عرض خاص|[٠-٩\d]+\s*[%٪]|\bdiscount\b|\bsale\b|\b\d+\s*%\s*off\b/i, msg: 'تحتوي الفكرة على خصم أو عرض — لا تُذكر الخصومات في التصميم' },
  { re: /(خلال|في|بـ?)\s*[٠-٩\d]+\s*(ساعة|ساعات|يوم|أيام|دقيقة|دقائق)|نفس اليوم|توصيل سريع خلال|\bsame[- ]day\b|\bwithin\s+\d+\s*(hours?|days?)\b/i, msg: 'تحتوي الفكرة على مدة تسليم — لا تُذكر مدد التسليم في التصميم' },
];

export function ideaGuard(idea: string): string[] {
  const t = idea.trim();
  if (!t) return [];
  return RULES.filter((r) => r.re.test(t)).map((r) => r.msg);
}
