import { describe, expect, it } from 'vitest';
import { welch, samplesNeeded, tTestP } from '@/lib/analytics/stats';
import { analyse, type Sample } from '@/lib/analytics/insights';
import { matchMetrics } from '@/lib/analytics/import';
import { engagementRate } from '@/lib/analytics/score';
import { parsePostMetrics } from '@/lib/publishing/metricool';
import { qcVerdict, type QcReport } from '@/lib/qc';
import { redact } from '@/lib/ops/log';

describe('statistics', () => {
  it('t distribution and Welch test match reference values', () => {
    expect(tTestP(2.228, 10)).toBeCloseTo(0.05, 3); // t(0.975, 10) = 2.228
    expect(tTestP(0, 5)).toBeCloseTo(1, 6);
    const w = welch([10, 12, 11, 13, 12, 11], [8, 9, 7, 8, 9, 8]);
    expect(w.p).toBeLessThan(0.001);
    expect(welch([1], [2, 3]).p).toBeNaN();
    expect(samplesNeeded(1, 0.5)).toBe(64);
  });
  it('confirms a pattern only with enough data; small samples stay a TREND with an experiment', () => {
    const big: Sample[] = [
      ...Array.from({ length: 8 }, (_, i) => ({ score: 6 + (i % 3) * 0.2, dims: { format: 'REEL_VIDEO' } })),
      ...Array.from({ length: 8 }, (_, i) => ({ score: 2 + (i % 3) * 0.2, dims: { format: 'IMAGE_STORY' } })),
    ];
    const a = analyse(big).insights.find((i) => i.dimension === 'format')!;
    expect(a.confidence).toBe('CONFIRMED'); expect(a.best.value).toBe('REEL_VIDEO'); expect(a.experiment).toBeUndefined();
    const small = analyse(big.filter((_, i) => i % 4 === 0)).insights.find((i) => i.dimension === 'format')!;
    expect(small.confidence).toBe('TREND'); expect(small.experiment).toBeDefined();
    expect(analyse([]).insights).toEqual([]);
  });
});

describe('metrics parsing, scoring and matching', () => {
  it('tolerant parser keeps missing metrics undefined', () => {
    const [p] = parsePostMetrics({ data: [{ url: 'u', reach: '120', likes: 3, saved: 2, published: { dateTime: '2026-11-01T10:00:00Z' } }] }, 'posts');
    expect(p).toMatchObject({ url: 'u', reach: 120, likes: 3, saves: 2 });
    expect(p.shares).toBeUndefined(); expect(p.publishedAt?.toISOString()).toBe('2026-11-01T10:00:00.000Z');
  });
  it('no reach/views → no score', () => {
    expect(engagementRate({ likes: 10 })).toBeNull();
    expect(engagementRate({ views: 200, likes: 4 })).toBe(2);
  });
  it('time match only when unique and same post type', () => {
    const at = new Date('2026-11-01T07:00:00Z');
    expect(matchMetrics({ scheduledFor: at, format: 'REEL_VIDEO' }, [{ kind: 'posts', publishedAt: at, raw: {} }])).toBeNull();
    expect(matchMetrics({ scheduledFor: at, format: 'REEL_VIDEO' }, [{ kind: 'reels', publishedAt: new Date(at.getTime() + 5 * 60_000), raw: {} }])?.method).toBe('time');
  });
});

describe('QC verdicts', () => {
  const r = (checks: QcReport['checks'], requiresHuman = false): QcReport => ({ passed: true, publishable: true, checks, checkedAt: '', requiresHuman });
  const c = (id: string, passed: boolean, severity: 'BLOCKER' | 'WARNING' = 'BLOCKER') => ({ id, label: id, passed, severity });
  it('maps reports to PASS / NEEDS_REVIEW / NEEDS_ASSET / REJECTED', () => {
    expect(qcVerdict(r([c('phones', true)]))).toBe('PASS');
    expect(qcVerdict(r([c('phones', true)], true))).toBe('NEEDS_REVIEW');
    expect(qcVerdict(r([c('ai_text_review', false, 'WARNING')]))).toBe('NEEDS_REVIEW');
    expect(qcVerdict(r([c('logo_fingerprint', false)]))).toBe('NEEDS_ASSET');
    expect(qcVerdict(r([c('logo_present', false), c('claims', false)]))).toBe('REJECTED');
    expect(qcVerdict(null)).toBe('NEEDS_ASSET');
  });
});

describe('log redaction', () => {
  it('masks secret keys and token-like values', () => {
    const out = redact({ token: 'abc', nested: { 'X-Mc-Auth': 'zzz', note: 'key sk-abcdefghijklmnop1234 used' }, ok: 1 }) as Record<string, unknown>;
    expect(out.token).toBe('[REDACTED]');
    expect((out.nested as Record<string, string>)['X-Mc-Auth']).toBe('[REDACTED]');
    expect((out.nested as Record<string, string>).note).not.toContain('sk-abc');
    expect(out.ok).toBe(1);
  });
});
