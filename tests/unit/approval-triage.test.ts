import { describe, expect, it } from 'vitest';
import { sortQueue, triage, waitLabel } from '@/lib/approvals/triage';

const now = new Date('2026-11-26T12:00:00Z'), h = (n: number) => new Date(now.getTime() - n * 3600_000);
const t = (o: Partial<Parameters<typeof triage>[0]>) => triage({ publishable: true, verdict: 'PASS', dryRun: false, createdAt: h(1), ...o }, now);

describe('approval triage: the order a busy owner reviews in', () => {
  it('lanes: publishable → ready; review warnings / missing asset → attention; trial or hard failure → blocked', () => {
    expect(t({}).lane).toBe('ready');
    expect(t({ publishable: false, verdict: 'NEEDS_REVIEW' }).lane).toBe('attention');
    expect(t({ publishable: false, verdict: 'NEEDS_ASSET' }).lane).toBe('attention');
    expect(t({ verdict: 'REJECTED', publishable: false }).lane).toBe('blocked');
    expect(t({ dryRun: true }).lane).toBe('blocked');
  });
  it('quality: the /100 rubric when scored, else the algorithm score, else nothing (never invented)', () => {
    expect(t({ rubric: 96, algorithm: 70 })).toMatchObject({ quality: 96, qualitySource: 'rubric' });
    expect(t({ algorithm: 70 })).toMatchObject({ quality: 70, qualitySource: 'algorithm' });
    expect(t({})).toMatchObject({ quality: null, qualitySource: null });
  });
  it('order: ready best-first (ties older first), then attention oldest-first, then blocked', () => {
    const items = [
      { k: 'att-new', createdAt: h(1), triage: t({ publishable: false, verdict: 'NEEDS_REVIEW', createdAt: h(1) }) },
      { k: 'blocked', createdAt: h(50), triage: t({ dryRun: true, createdAt: h(50) }) },
      { k: 'ready-80', createdAt: h(2), triage: t({ algorithm: 80, createdAt: h(2) }) },
      { k: 'att-old', createdAt: h(9), triage: t({ publishable: false, verdict: 'NEEDS_ASSET', createdAt: h(9) }) },
      { k: 'ready-95', createdAt: h(1), triage: t({ rubric: 95, createdAt: h(1) }) },
      { k: 'ready-80-old', createdAt: h(5), triage: t({ algorithm: 80, createdAt: h(5) }) },
    ];
    expect(sortQueue(items).map((i) => i.k)).toEqual(['ready-95', 'ready-80-old', 'ready-80', 'att-old', 'att-new', 'blocked']);
  });
  it('waiting labels in Arabic', () => {
    expect(waitLabel(0.5)).toBe('منذ 30 د');
    expect(waitLabel(5)).toBe('منذ 5 س');
    expect(waitLabel(26)).toBe('منذ يوم');
    expect(waitLabel(49)).toBe('منذ يومين');
    expect(waitLabel(24 * 6)).toBe('منذ 6 أيام');
  });
});
