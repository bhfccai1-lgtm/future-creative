import { describe, expect, it } from 'vitest';
import { errorSignature, meanZ, pareto, percentile, poissonZ, twoPropZ, verdictOf } from '@/lib/ops/analysis';

describe('diagnostics statistics: a change is «real» only when the data supports it', () => {
  it('two-proportion z-test: 93 % → 50 % on 30 jobs each is real; 90 % → 87 % is noise; tiny samples are not judged', () => {
    const z = twoPropZ(15, 30, 28, 30)!;
    expect(z).toBeLessThan(-1.96);
    expect(verdictOf(z, 'up')).toBe('worsened');
    expect(verdictOf(twoPropZ(26, 30, 27, 30), 'up')).toBe('stable');
    expect(twoPropZ(3, 5, 5, 5)).toBeNull();
    expect(verdictOf(null, 'up')).toBe('insufficient');
  });
  it('counts (Poisson) and means (Welch)', () => {
    expect(verdictOf(poissonZ(60, 30), 'up')).toBe('improved');
    expect(verdictOf(poissonZ(32, 30), 'up')).toBe('stable');
    expect(poissonZ(3, 2)).toBeNull();
    const hi = Array.from({ length: 20 }, (_, i) => 8 + (i % 3)), lo = Array.from({ length: 20 }, (_, i) => 4 + (i % 3));
    expect(meanZ(hi, lo)!).toBeGreaterThan(1.96);
    expect(verdictOf(meanZ(lo, hi), 'up')).toBe('worsened');
  });
  it('percentiles (nearest rank)', () => {
    const xs = [5, 1, 9, 3, 7, 2, 8, 4, 6, 10];
    expect(percentile(xs, 50)).toBe(5);
    expect(percentile(xs, 90)).toBe(9);
    expect(percentile([], 50)).toBeNull();
  });
  it('the same failure counts once whatever its ids, numbers, urls or quoted names', () => {
    const a = errorSignature('Metricool 502 for post clx8f9a0b1c2d3e4f5g6h7i8 at https://app.metricool.com/x?id=9');
    const b = errorSignature('Metricool 503 for post clz1y2x3w4v5u6t7s8r9q0p1 at https://app.metricool.com/y');
    expect(a).toBe(b);
    expect(errorSignature('')).toBe('(بدون رسالة)');
  });
  it('Pareto: most frequent first, shares and the running total', () => {
    const items = [...Array(6).fill({ source: 'النشر', key: 'A' }), ...Array(3).fill({ source: 'النشر', key: 'B' }), { source: 'فحص الجودة', key: 'C' }];
    const p = pareto(items);
    expect(p.map((x) => [x.key, x.count, x.share, x.cumulative])).toEqual([['A', 6, 60, 60], ['B', 3, 30, 90], ['C', 1, 10, 100]]);
  });
});
