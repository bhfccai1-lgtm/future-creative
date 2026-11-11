import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { integrationApi } from '@/lib/integrations/auth';
import { approveAdvertisement, rejectAdvertisement } from '@/lib/publishing/jobs';
import { AppError } from '@/lib/errors';

const Body = z.object({ decision: z.enum(['approve', 'reject']), by: z.string().max(80), note: z.string().max(300).optional() });

/**
 * POST — approve/reject from an n8n flow (e.g. Telegram buttons). Disabled unless the admin enables it.
 * Uses the same guarded functions as the dashboard: QC gate, SHA-256 approval binding, kill switch, pause.
 * The decision is attributed to the system admin user with the actor label "n8n:<by>".
 */
export const POST = integrationApi<{ params: Promise<{ id: string }> }>(async (req, { params, settings }) => {
  if (!settings.n8n.allowInboundApprovals) throw new AppError('FORBIDDEN', 'الاعتماد عبر n8n غير مسموح في الإعدادات.', 403);
  const { id } = await params;
  const b = Body.parse(await req.json());
  const admin = await prisma.user.findFirst({ where: { role: { name: 'ADMIN' }, active: true }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new AppError('NO_ADMIN', 'لا يوجد مدير نشط لنسب القرار إليه.', 409);
  const actor = { id: admin.id, email: `n8n:${b.by}` };
  if (b.decision === 'approve') await approveAdvertisement(id, actor, b.note ?? 'approved via n8n');
  else await rejectAdvertisement(id, actor, b.note ?? 'rejected via n8n');
  const ad = await prisma.advertisement.findUniqueOrThrow({ where: { id }, select: { state: true } });
  return NextResponse.json({ adId: id, state: ad.state });
});
