import type { Analysis } from './brief';
import { FINISHES } from './catalog';
import type { Identity } from './identity';

/**
 * CREATIVE IDEATION: three directions built from the activity (brainstorm + SCAMPER-style substitutions + a visual
 * metaphor), scored on six criteria. The best is chosen; the others stay available as alternatives.
 */
export type ConceptKey = 'A' | 'B' | 'C';
export interface Concept {
  key: ConceptKey; name: string; idea: string; metaphor: string;
  palette: Identity['palette']; layout: 'centered' | 'split' | 'band' | 'frame'; decor: Identity['decor'] | 'none';
  finishes: string[]; imagery: string;
  scores: { relevance: number; audience: number; appeal: number; clarity: number; production: number; finishCost: number }; total: number;
}
const METAPHORS: Record<string, string> = {
  fine_dining: 'طاولة مضاءة بشمعة — الفخامة في التفاصيل', restaurant: 'المكونات الطازجة كأنها تنفجر من الصورة', medical: 'خط نبض هادئ يتحول إلى رمز رعاية', real_estate: 'خطوط معمارية تفتح على أفق', toys: 'قطع ملونة تبني الحروف', perfume: 'أثر العطر كدخان ذهبي', school: 'كتاب مفتوح تخرج منه الأفكار', beauty: 'بتلات ناعمة تحيط بالمنتج', auto: 'خطوط السرعة على سطح لامع', tech: 'شبكة نقاط تتصل', events: 'إطار زخرفي ذهبي حول اللحظة', ramadan_eid: 'هلال وفانوس بزخرفة عربية', retail: 'المنتج بطل المشهد مع عرض واضح', general: 'شكل هندسي بسيط يحمل الرسالة',
};
const shade = (hex: string, f: number) => { const n = parseInt(hex.slice(1), 16); const ch = (v: number) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f))); return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, '0')).join('')}`; };
const clamp = (v: number) => Math.max(1, Math.min(10, Math.round(v)));

export function buildConcepts(a: Analysis, availableFinishes: string[]): Concept[] {
  const id = a.identity, p = id.palette;
  const luxuryIndustry = ['fine_dining', 'perfume', 'real_estate', 'events', 'beauty'].includes(id.id);
  const playful = ['toys', 'school'].includes(id.id);
  const fin = (want: string[]) => want.filter((f) => availableFinishes.includes(f));
  const small = a.trim.w * a.trim.h < 120 * 120;
  const big = a.product.family === 'large_format';
  const raw: Omit<Concept, 'total'>[] = [
    { key: 'A', name: 'فاخر وبسيط', idea: 'مساحات بيضاء واسعة، عنصر واحد قوي، خط أنيق، لون داكن مع لمسة معدنية', metaphor: METAPHORS[id.id] ?? METAPHORS.general,
      palette: { ...p, primary: luxuryIndustry ? p.primary : shade(p.primary, -0.25), bg: luxuryIndustry && id.id === 'perfume' ? p.bg : '#fdfbf6' }, layout: 'frame', decor: 'gold_lines', finishes: fin(['soft_touch', 'gold_foil', 'spot_uv']), imagery: `${id.photography}, minimal composition, generous negative space`,
      scores: { relevance: luxuryIndustry ? 9 : 6, audience: luxuryIndustry ? 9 : 6, appeal: 8, clarity: 9, production: fin(['gold_foil']).length ? 7 : 8, finishCost: fin(['gold_foil']).length ? 5 : 8 } },
    { key: 'B', name: 'إبداعي وجريء', idea: 'تكوين قطري، ألوان مشبعة، عنوان ضخم، عنصر بصري يكسر الإطار', metaphor: METAPHORS[id.id] ?? METAPHORS.general,
      palette: { ...p, primary: p.accent, secondary: p.secondary, accent: p.primary }, layout: 'split', decor: playful ? 'playful' : 'geometric', finishes: fin(['gloss_lam', 'spot_uv']), imagery: `${id.photography}, bold dynamic angle, vivid colour`,
      scores: { relevance: playful ? 9 : 7, audience: playful ? 9 : 6, appeal: 9, clarity: small ? 6 : 7, production: 8, finishCost: 8 } },
    { key: 'C', name: 'حديث ومتخصص في النشاط', idea: `هوية ${id.ar}: ${id.style}، شبكة منظمة، أيقونات ومعلومات واضحة`, metaphor: METAPHORS[id.id] ?? METAPHORS.general,
      palette: p, layout: big ? 'band' : 'band', decor: id.decor, finishes: fin(id.finishes), imagery: `${id.photography}, ${id.textures}`,
      scores: { relevance: 9, audience: 8, appeal: 7, clarity: big ? 10 : 9, production: 9, finishCost: fin(id.finishes).some((f) => FINISHES[f]?.separation) ? 6 : 9 } },
  ];
  return raw.map((c) => { const s = Object.fromEntries(Object.entries(c.scores).map(([k, v]) => [k, clamp(v)])) as Concept['scores']; return { ...c, scores: s, total: Math.round(((s.relevance * 2 + s.audience * 2 + s.appeal * 1.5 + s.clarity * 1.5 + s.production + s.finishCost) / 9) * 10) / 10 }; });
}
export const bestConcept = (cs: Concept[]) => [...cs].sort((a, b) => b.total - a.total)[0];
