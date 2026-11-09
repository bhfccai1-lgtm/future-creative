import type { FingerprintKind } from '@prisma/client';
import { prisma } from '../db';
import { hamming } from './phash';
import { normalizeText, similarity } from './text';

export const PHASH_DUP_DISTANCE = 6; // ≤6/64 bits differ ⇒ visually the same image
export const HEADLINE_DUP_SIMILARITY = 0.8;
export const IDEA_DUP_SIMILARITY = 0.72;

export interface DupCandidate { sha256?: string; phash?: string; headline?: string; idea?: string; productOccasion?: string }
export interface DupFinding { kind: FingerprintKind; scope: 'account' | 'cross-account'; matchAdId: string; detail: string }

/**
 * Multi-level duplicate check against the account's history in the window, plus a cross-account check
 * for identical media (prevents blasting the exact same creative to several accounts).
 */
export async function findDuplicates(accountId: string, c: DupCandidate, windowDays: number, excludeAdId?: string): Promise<DupFinding[]> {
  const since = new Date(Date.now() - windowDays * 86400_000);
  const rows = await prisma.contentFingerprint.findMany({
    where: { accountId, createdAt: { gte: since }, ...(excludeAdId ? { advertisementId: { not: excludeAdId } } : {}), advertisement: { state: { notIn: ['REJECTED', 'FAILED'] } } },
    select: { kind: true, value: true, advertisementId: true },
  });
  const out: DupFinding[] = [];
  for (const r of rows) {
    if (r.kind === 'FILE_SHA256' && c.sha256 && r.value === c.sha256) out.push({ kind: r.kind, scope: 'account', matchAdId: r.advertisementId, detail: 'نفس الملف تمامًا' });
    if (r.kind === 'PHASH' && c.phash && hamming(r.value, c.phash) <= PHASH_DUP_DISTANCE) out.push({ kind: r.kind, scope: 'account', matchAdId: r.advertisementId, detail: `صورة متطابقة بصريًا (فرق ${hamming(r.value, c.phash)} بت)` });
    if (r.kind === 'HEADLINE' && c.headline) {
      const sim = r.value === normalizeText(c.headline) ? 1 : similarity(r.value, c.headline);
      if (sim >= HEADLINE_DUP_SIMILARITY) out.push({ kind: r.kind, scope: 'account', matchAdId: r.advertisementId, detail: `عنوان مكرر (تشابه ${(sim * 100).toFixed(0)}%)` });
    }
    if (r.kind === 'IDEA' && c.idea) {
      const sim = similarity(r.value.split('::')[1] ?? r.value, c.idea.split('::')[1] ?? c.idea);
      if (r.value.split('::')[0] === c.idea.split('::')[0] && sim >= IDEA_DUP_SIMILARITY) out.push({ kind: r.kind, scope: 'account', matchAdId: r.advertisementId, detail: `فكرة مشابهة (تشابه ${(sim * 100).toFixed(0)}%)` });
    }
    if (r.kind === 'PRODUCT_OCCASION' && c.productOccasion && r.value === c.productOccasion && c.idea) {
      // Same product+occasion is allowed with a genuinely different concept — reported as info only via idea check.
    }
  }
  if (c.sha256 || c.phash) {
    const cross = await prisma.contentFingerprint.findMany({
      where: { accountId: { not: accountId }, createdAt: { gte: since }, kind: { in: ['FILE_SHA256', 'PHASH'] }, ...(excludeAdId ? { advertisementId: { not: excludeAdId } } : {}) },
      select: { kind: true, value: true, advertisementId: true },
    });
    for (const r of cross) {
      if (r.kind === 'FILE_SHA256' && r.value === c.sha256) out.push({ kind: r.kind, scope: 'cross-account', matchAdId: r.advertisementId, detail: 'نفس الملف منشور على حساب آخر' });
      if (r.kind === 'PHASH' && c.phash && hamming(r.value, c.phash) <= 2) out.push({ kind: r.kind, scope: 'cross-account', matchAdId: r.advertisementId, detail: 'نفس التصميم على حساب آخر دون تكييف' });
    }
  }
  return out;
}

export async function recentIdeas(accountId: string, windowDays: number) {
  const since = new Date(Date.now() - windowDays * 86400_000);
  const briefs = await prisma.creativeBrief.findMany({ where: { accountId, createdAt: { gte: since } }, select: { ideaKey: true, idea: true, headline: true }, orderBy: { createdAt: 'desc' }, take: 200 });
  return { ideas: briefs.flatMap((b) => [b.ideaKey, b.idea]), headlines: briefs.map((b) => b.headline) };
}

export async function storeFingerprints(accountId: string, advertisementId: string, f: { kind: FingerprintKind; value: string }[]) {
  await prisma.contentFingerprint.createMany({ data: f.map((x) => ({ accountId, advertisementId, kind: x.kind, value: x.value })) });
}
