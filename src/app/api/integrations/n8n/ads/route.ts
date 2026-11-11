import { NextResponse } from 'next/server';
import type { AdState, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { integrationApi } from '@/lib/integrations/auth';
import { signedMediaUrl } from '@/lib/storage';
import { qcVerdict, type QcReport } from '@/lib/qc';

const STATES = ['QUALITY_REVIEW', 'APPROVED', 'QUEUED', 'SCHEDULED', 'PUBLISHED', 'FAILED', 'UNKNOWN', 'REJECTED'];
/** GET ?state=QUALITY_REVIEW&account=<id>&since=<ISO>&limit=20 — designs with signed preview links (e.g. pending approvals for a bot). */
export const GET = integrationApi(async (req) => {
  const u = new URL(req.url);
  const state = u.searchParams.get('state');
  const since = u.searchParams.get('since');
  const where: Prisma.AdvertisementWhereInput = {
    ...(state && STATES.includes(state) ? { state: state as AdState } : {}),
    ...(u.searchParams.get('account') ? { accountId: u.searchParams.get('account')! } : {}),
    ...(since && !Number.isNaN(Date.parse(since)) ? { createdAt: { gte: new Date(since) } } : {}),
  };
  const take = Math.min(50, Math.max(1, Number(u.searchParams.get('limit')) || 20));
  const ads = await prisma.advertisement.findMany({ where, orderBy: { createdAt: 'desc' }, take, include: { account: { select: { name: true, handle: true } }, media: { where: { role: 'FINAL' }, take: 1 } } });
  return NextResponse.json(ads.map((a) => ({
    id: a.id, state: a.state, format: a.format, language: a.language, account: a.account.name, handle: a.account.handle, headline: a.headline,
    qc: qcVerdict(a.qcReport as unknown as QcReport | null), dryRun: a.dryRun, createdAt: a.createdAt,
    imageUrl: a.media[0] ? signedMediaUrl(a.media[0].storageKey, 3 * 86400) : null, reviewUrl: `/ads/${a.id}`,
  })));
});
