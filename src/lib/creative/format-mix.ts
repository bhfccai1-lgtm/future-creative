import type { MediaFormat } from '@prisma/client';
import { prisma } from '../db';

/**
 * Growth content mix. Real account data (Nov 2026, 15 brands): on accounts with ~10–15 followers Reels reached
 * 59–90 people while feed images reached ~12 (followers only) and stories added almost nothing — so Reels
 * carry discovery, feed builds the profile grid, stories keep existing followers warm.
 */
/** Reels = discovery, carousels = saves/shares (zero saves/shares were measured with single images), feed = grid, stories = warm followers. */
export const DEFAULT_MIX: Partial<Record<MediaFormat, number>> = { REEL_VIDEO: 50, IMAGE_CAROUSEL: 25, IMAGE_FEED: 15, IMAGE_STORY: 10 };

export function normaliseMix(raw: unknown): Partial<Record<MediaFormat, number>> {
  const allowed: MediaFormat[] = ['REEL_VIDEO', 'IMAGE_CAROUSEL', 'IMAGE_FEED', 'IMAGE_STORY', 'IMAGE_SQUARE'];
  const out: Partial<Record<MediaFormat, number>> = {};
  if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw)) if (allowed.includes(k as MediaFormat) && typeof v === 'number' && v > 0) out[k as MediaFormat] = v;
  return Object.keys(out).length ? out : DEFAULT_MIX;
}

/** Pure: the format with the largest deficit vs its target share (ties → order of the mix). */
export function pickFormat(mix: Partial<Record<MediaFormat, number>>, recent: Partial<Record<MediaFormat, number>>): MediaFormat {
  const total = Object.values(mix).reduce((a, b) => a + (b ?? 0), 0);
  const done = Object.values(recent).reduce((a, b) => a + (b ?? 0), 0);
  let best: MediaFormat | null = null; let bestGap = -Infinity;
  for (const [f, w] of Object.entries(mix) as [MediaFormat, number][]) {
    const gap = (w / total) * (done + 1) - (recent[f] ?? 0);
    if (gap > bestGap) { bestGap = gap; best = f; }
  }
  return best ?? 'REEL_VIDEO';
}

/** Chooses the next format for an account from its last 14 days of designs (failed/rejected ignored). */
export async function nextFormatFor(account: { id: string; publishFormat: MediaFormat; formatStrategy: string; formatMix: unknown }): Promise<MediaFormat> {
  if (account.formatStrategy !== 'GROWTH_MIX') return account.publishFormat;
  const rows = await prisma.advertisement.groupBy({
    by: ['format'], _count: true,
    where: { accountId: account.id, createdAt: { gte: new Date(Date.now() - 14 * 86400_000) }, state: { notIn: ['FAILED', 'REJECTED'] } },
  });
  return pickFormat(normaliseMix(account.formatMix), Object.fromEntries(rows.map((r) => [r.format, r._count])));
}
