import type { IdeaSuggestion } from '../ai/types';

/**
 * STEP 02 — «ثلاثة مفاهيم، يُختار أقواها»: the creative director proposes 3 distinct concepts; this rubric picks one.
 *
 * Documented rubric (0–100, weights sum to 1):
 *   1. creative strength 40 % — the model's own 1–10 rating of the concept (originality, scroll-stopping power, clarity).
 *   2. novelty           30 % — 1 − highest word-overlap (Jaccard) with ideas/headlines used by this account in the last 30 days.
 *   3. fit               20 % — the concept's suggested format matches the requested format (+), humour on a formal/corporate
 *                               account (−), forbidden commercial claims (prices, discounts, «الأفضل», free…) (hard −).
 *   4. angle freshness   10 % — the angle was not among the account's last 10 used angles.
 * A concept with a forbidden claim can never win while a clean one exists. The scores are a ranking aid, not proof of quality.
 */
export interface ConceptScore { title: string; idea: string; angle: string | null; total: number; parts: { strength: number; novelty: number; fit: number; freshness: number }; notes: string[] }

const words = (t: string) => new Set(t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2));
export function jaccard(a: string, b: string) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}
const HUMOUR = /funny|humou?r|joke|comic|cartoon|مضحك|نكتة|كرتون|فكاهي|طريف|ساخر/i;
const CLAIMS = /\d+\s*(%|bd|د\.?ب|ريال|sar)|خصم|تخفيض|مجان|free\b|discount|sale\b|أرخص|الأفضل|رقم\s*1|best\b|cheapest|delivery in|توصيل خلال/i;

export function scoreConcepts(ideas: IdeaSuggestion[], ctx: { format?: string; formal: boolean; history: string[]; recentAngles: string[] }): ConceptScore[] {
  return ideas.map((x) => {
    const text = [x.title, x.idea, x.hook ?? ''].join(' ');
    const notes: string[] = [];
    const strength = Math.min(10, Math.max(1, typeof x.score === 'number' && Number.isFinite(x.score) ? x.score : 6)) / 10;
    const overlap = Math.max(0, ...ctx.history.map((h) => jaccard(text, h)));
    const novelty = 1 - overlap;
    if (overlap > 0.5) notes.push(`قريبة من فكرة سابقة (${Math.round(overlap * 100)}%)`);
    let fit = 0.6;
    if (ctx.format && x.format === ctx.format) fit += 0.4;
    if (ctx.formal && HUMOUR.test(text)) { fit -= 0.5; notes.push('فكاهة لا تناسب حسابًا رسميًا'); }
    const claim = CLAIMS.test(text);
    if (claim) notes.push('تحتوي ادعاءً تجاريًا ممنوعًا');
    const angle = x.angle?.split(':')[0] ?? null;
    const freshness = angle && ctx.recentAngles.includes(angle) ? 0 : 1;
    const total = Math.round((0.4 * strength + 0.3 * novelty + 0.2 * Math.max(0, fit) + 0.1 * freshness) * 100) - (claim ? 100 : 0);
    return { title: x.title, idea: x.idea, angle, total, parts: { strength: +strength.toFixed(2), novelty: +novelty.toFixed(2), fit: +Math.max(0, fit).toFixed(2), freshness }, notes };
  }).sort((a, b) => b.total - a.total);
}
