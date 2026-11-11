import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
const Body = z.object({ likes: z.number().int().min(0), comments: z.number().int().min(0), saves: z.number().int().min(0), shares: z.number().int().min(0), reach: z.number().int().min(1) });
/** Record engagement metrics for a VERIFIED publication (manual entry or future analytics import). */
export const PUT = api<{ params: Promise<{ id: string }> }>('ads:approve', async (req, { params, user }) => {
  const { id } = await params;
  const m = Body.parse(await req.json());
  const r = await prisma.publicationResult.findUniqueOrThrow({ where: { id } });
  if (!r.verifiedAt) throw new AppError('NOT_VERIFIED', 'لا يمكن إدخال أداء لمنشور غير مؤكد النشر.', 409);
  const score = ((m.likes + 2 * m.comments + 3 * m.saves + 3 * m.shares) / m.reach) * 100;
  const u = await prisma.publicationResult.update({ where: { id }, data: { metrics: m, engagementScore: score, metricsSource: 'manual', metricsFetchedAt: new Date() } });
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'result.metrics', targetType: 'publication_result', targetId: id, details: m });
  return NextResponse.json(u);
});
