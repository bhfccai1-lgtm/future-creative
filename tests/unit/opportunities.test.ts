import { describe, expect, it } from 'vitest';
import type { Advice } from '@/lib/ops/advisor';
import { effortOf, rankOpportunities } from '@/lib/ops/opportunities';

const A = (id: string, severity: Advice['severity'], category: Advice['category'], steps: string[], evidence = 'x', link?: string): Advice => ({ id, severity, category, title: id, evidence, why: '', steps, link });

describe('«ابدأ من هنا»: one list, ranked like a consultant (impact × ease × confidence)', () => {
  it('critical first; then a one-click fix beats an equal problem that needs the server; duplicates merged; quick wins marked', () => {
    const fixes: Record<string, { id: string }> = { metrics_missing: { id: 'metrics_import' } };
    const r = rankOpportunities([
      A('metrics_missing', 'medium', 'growth', ['«إصلاح الآن»']),
      A('cpu_load', 'medium', 'reliability', ['على الخادم: docker compose restart worker']),
      A('migrations', 'critical', 'reliability', ['bash scripts/update.sh']),
      A('approval_wait', 'medium', 'publishing', ['خصص وقتًا يوميًا ثابتًا للموافقات']),
      A('metrics_missing', 'medium', 'growth', ['duplicate from another layer']),
      A('small_sample', 'info', 'growth', ['انشر أكثر'], 'عينة صغيرة'),
    ], (id) => fixes[id] ?? null);
    expect(r.map((x) => x.advice.id)).toEqual(['migrations', 'metrics_missing', 'approval_wait', 'cpu_load', 'small_sample']);
    expect(r[1]).toMatchObject({ effort: 'click', fixId: 'metrics_import', quickWin: true, score: 100 });
    expect(r.find((x) => x.advice.id === 'cpu_load')).toMatchObject({ effort: 'server', quickWin: false });
    expect(r.find((x) => x.advice.id === 'approval_wait')!.effort).toBe('habit');
    expect(r.find((x) => x.advice.id === 'small_sample')!.confidence).toBe(0.5);
    expect(r.map((x) => x.rank)).toEqual([1, 2, 3, 4, 5]);
  });
  it('effort: settings link without a server step = minutes', () => {
    expect(effortOf(A('x', 'low', 'growth', ['الحسابات ← القنوات التلقائية'], 'x', '/accounts'), false)).toBe('minutes');
  });
});
