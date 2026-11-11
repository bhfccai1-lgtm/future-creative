import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { getAdapter } from '../publishing/registry';
import type { MetricoolAdapter } from '../publishing/metricool';
import { log } from '../ops/log';
import { analyseCompetitors } from './analysis';
import { parseCompetitorPosts, parseCompetitors, parseCsv } from './parse';
import type { CompetitorPost, CompetitorSummary, OwnPost } from './types';

const revive = (posts: unknown): CompetitorPost[] => ((posts as CompetitorPost[] | null) ?? []).map((p) => ({ ...p, publishedAt: p.publishedAt ? new Date(p.publishedAt as unknown as string) : undefined }));

/** Brands (Metricool blogIds) that have at least one linked account in the system. */
export async function linkedBrands() {
  const conns = await prisma.socialConnection.findMany({ where: { providerBrandId: { not: null } }, include: { account: { select: { id: true, name: true, handle: true, language: true } } } });
  const m = new Map<string, { brandId: string; accounts: { id: string; name: string; handle: string | null; language: string }[] }>();
  for (const c of conns) { const b = m.get(c.providerBrandId!) ?? { brandId: c.providerBrandId!, accounts: [] }; b.accounts.push(c.account); m.set(c.providerBrandId!, b); }
  return [...m.values()];
}

/** Pulls competitor data from Metricool for one brand (or all linked brands) and stores a snapshot. */
export async function importCompetitors(brandId?: string, now = new Date()) {
  const adapter = (await getAdapter('metricool')) as unknown as Partial<MetricoolAdapter>;
  if (!adapter.listCompetitorRows) return { skipped: 'ADAPTER_HAS_NO_COMPETITORS' };
  const brands = brandId ? [brandId] : (await linkedBrands()).map((b) => b.brandId);
  const out: Record<string, string> = {};
  for (const b of brands) {
    try {
      const r = await adapter.listCompetitorRows(b, new Date(now.getTime() - 30 * 86400_000), now);
      const competitors = parseCompetitors(r.competitors);
      const posts = [...parseCompetitorPosts(r.posts, 'post'), ...parseCompetitorPosts(r.reels, 'reel')];
      await prisma.competitorSnapshot.create({ data: { brandId: b, source: 'metricool', competitors: competitors as unknown as Prisma.InputJsonValue, posts: posts as unknown as Prisma.InputJsonValue } });
      out[b] = `${competitors.length} competitors, ${posts.length} posts`;
    } catch (e) {
      out[b] = `ERROR: ${(e as Error).message}`;
      log.warn('competitors.import_failed', { brandId: b, error: (e as Error).message });
    }
  }
  return out;
}

/**
 * Imports a Metricool CSV export (competitors table and/or competitor posts). Posts are detected by a caption
 * column. A file uploaded the same day is merged into that day's CSV snapshot so both tables can be combined.
 */
export async function importCompetitorCsv(brandId: string, csv: string, now = new Date()) {
  const rows = parseCsv(csv);
  if (!rows.length) throw new Error('الملف فارغ أو غير مقروء');
  const cols = Object.keys(rows[0]).map((c) => c.toLowerCase());
  const isPosts = cols.some((c) => /content|caption|text|النص|المحتوى/.test(c));
  const competitors: CompetitorSummary[] = isPosts ? [] : parseCompetitors(rows);
  const posts: CompetitorPost[] = isPosts ? parseCompetitorPosts(rows) : [];
  if (!competitors.length && !posts.length) throw new Error('لم أجد أعمدة الحساب (screenName/username) في الملف');
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  const today = await prisma.competitorSnapshot.findFirst({ where: { brandId, source: 'csv', takenAt: { gte: dayStart } }, orderBy: { takenAt: 'desc' } });
  const mergedComp = [...((today?.competitors as unknown as CompetitorSummary[]) ?? []).filter((c) => !competitors.some((x) => x.handle === c.handle)), ...competitors];
  const mergedPosts = [...revive(today?.posts).filter((p) => !posts.some((x) => (x.id && x.id === p.id) || (x.url && x.url === p.url))), ...posts];
  // competitors seen only in posts still get a row in the benchmark
  for (const h of new Set(mergedPosts.map((p) => p.handle))) if (!mergedComp.some((c) => c.handle === h)) mergedComp.push({ handle: h });
  const data = { competitors: mergedComp as unknown as Prisma.InputJsonValue, posts: mergedPosts as unknown as Prisma.InputJsonValue };
  const snap = today ? await prisma.competitorSnapshot.update({ where: { id: today.id }, data }) : await prisma.competitorSnapshot.create({ data: { brandId, source: 'csv', ...data } });
  return { snapshotId: snap.id, kind: isPosts ? 'posts' : 'competitors', rows: isPosts ? posts.length : competitors.length };
}

/** Full competitor report for a brand: latest snapshot vs one ≥ 6 days older, plus our own verified posts. */
export async function competitorReport(brandId: string, now = new Date()) {
  const latest = await prisma.competitorSnapshot.findFirst({ where: { brandId, error: null }, orderBy: { takenAt: 'desc' } });
  if (!latest) return { brandId, snapshot: null, analysis: null };
  const previous = await prisma.competitorSnapshot.findFirst({ where: { brandId, error: null, takenAt: { lte: new Date(latest.takenAt.getTime() - 6 * 86400_000) } }, orderBy: { takenAt: 'desc' } });
  const accounts = await prisma.socialAccount.findMany({ where: { connection: { providerBrandId: brandId } }, select: { id: true, name: true, handle: true } });
  const ours = await prisma.publicationResult.findMany({
    where: { verifiedAt: { gte: new Date(now.getTime() - 30 * 86400_000) }, job: { accountId: { in: accounts.map((a) => a.id) } } },
    include: { job: { select: { scheduledFor: true, advertisement: { select: { format: true, caption: true } } } } },
  });
  const usPosts: OwnPost[] = ours.map((r) => {
    const m = (r.metrics ?? {}) as Record<string, number>;
    const total = ['likes', 'comments', 'saves', 'shares'].reduce((a, k) => a + (Number(m[k]) || 0), 0);
    const f = r.job.advertisement.format;
    return { type: f === 'REEL_VIDEO' ? 'reel' : f === 'IMAGE_STORY' ? 'story' : f === 'IMAGE_CAROUSEL' ? 'carousel' : 'post', caption: r.job.advertisement.caption ?? '', publishedAt: r.job.scheduledFor, interactions: r.metrics ? total : undefined };
  });
  const latestComp = latest.competitors as unknown as CompetitorSummary[];
  const usHandle = accounts.find((a) => a.handle)?.handle?.toLowerCase();
  const selfRow = usHandle ? latestComp.find((c) => c.handle === usHandle) : undefined; // Metricool often lists the brand itself
  const analysis = analyseCompetitors({
    now, latest: latestComp.filter((c) => c.handle !== usHandle), previous: previous ? (previous.competitors as unknown as CompetitorSummary[]) : null,
    previousDaysAgo: previous ? Math.round((latest.takenAt.getTime() - previous.takenAt.getTime()) / 86400_000) : null,
    posts: revive(latest.posts).filter((p) => p.handle !== usHandle),
    us: { name: accounts.map((a) => a.handle ?? a.name).join(' / ') || 'حساباتنا', followers: selfRow?.followers ?? null, posts: usPosts },
  });
  return { brandId, snapshot: { takenAt: latest.takenAt, source: latest.source, previousAt: previous?.takenAt ?? null }, analysis };
}
