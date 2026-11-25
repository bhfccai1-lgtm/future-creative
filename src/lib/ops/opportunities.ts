import type { Advice, Category, Severity } from './advisor';
import { fixFor } from './fixes';

/**
 * «ابدأ من هنا»: every finding of the four layers (advisor, analysis, platforms, tools & shop) in ONE list ranked
 * the way a consultant prioritises — impact × ease × confidence — so the owner sees what to do first and how long
 * it takes. Duplicates (the same id from two layers) are merged; quick wins (one click or a few minutes, real
 * impact) are marked.
 */
export type Effort = 'click' | 'minutes' | 'server' | 'habit';
export interface Opportunity {
  rank: number; advice: Advice; score: number; impact: number; ease: number; confidence: number;
  effort: Effort; quickWin: boolean; fixId: string | null; fixConfirm?: string;
}
export const EFFORT_AR: Record<Effort, string> = { click: 'زر واحد', minutes: 'دقائق في الإعدادات', server: 'أمر على الخادم', habit: 'عادة عمل يومية' };

const IMPACT: Record<Severity, number> = { critical: 10, high: 7, medium: 4, low: 2, info: 1 };
/** what blocks money first: a stopped system or lost customers outweigh reach or cost */
const AREA: Record<Category, number> = { reliability: 1.2, publishing: 1.15, integration: 1, growth: 1, content: 0.95, security: 1.1, cost: 0.85 };
const SERVER = /docker|bash scripts|\.env|ssh|Hetzner/i;
const HABIT = /يوميًا|يومي|عادة|خصص وقتًا|أسبوعيًا|كل يوم/;

export function effortOf(a: Advice, hasFix: boolean): Effort {
  if (hasFix) return 'click';
  const steps = a.steps.join(' ');
  if (SERVER.test(steps)) return 'server';
  if (HABIT.test(steps) && !a.link?.startsWith('/settings')) return 'habit';
  return 'minutes';
}
const EASE: Record<Effort, number> = { click: 10, minutes: 6, habit: 4, server: 3 };

/** lower confidence when the evidence itself says the sample is small or nothing was measured yet */
export function confidenceOf(a: Advice): number {
  if (a.id === 'small_sample' || /عينة صغيرة|غير كافية|لا مقاييس|لم تُستورد/.test(a.evidence)) return 0.5;
  if (/z = |z=/.test(a.evidence)) return 1; // significance-tested
  return 0.9;
}

export function rankOpportunities(all: Advice[], hasFix: (id: string) => { id: string; confirm?: string } | null = fixFor): Opportunity[] {
  const seen = new Set<string>();
  const uniq = all.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
  const scored = uniq.map((a) => {
    const fix = hasFix(a.id);
    const effort = effortOf(a, !!fix);
    const impact = Math.round(IMPACT[a.severity] * AREA[a.category] * 10) / 10, ease = EASE[effort], confidence = confidenceOf(a);
    return { advice: a, impact, ease, confidence, effort, fixId: fix?.id ?? null, fixConfirm: fix?.confirm, score: impact * ease * confidence, quickWin: (effort === 'click' || effort === 'minutes') && IMPACT[a.severity] >= 4 };
  });
  const max = Math.max(1, ...scored.map((s) => s.score));
  return scored
    .sort((x, y) => (IMPACT[y.advice.severity] >= 10 ? 1 : 0) - (IMPACT[x.advice.severity] >= 10 ? 1 : 0) || y.score - x.score) // critical always first
    .map((s, i) => ({ ...s, rank: i + 1, score: Math.round((s.score / max) * 100) }));
}
