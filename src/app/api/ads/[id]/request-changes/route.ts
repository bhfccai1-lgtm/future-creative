import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { MediaFormat } from '@prisma/client';
import { api } from '@/lib/auth/server';
import { prisma } from '@/lib/db';
import { enq } from '@/lib/queue/queues';
import { audit } from '@/lib/audit';
import { rejectAdvertisement } from '@/lib/publishing/jobs';
import { AppError } from '@/lib/errors';
import type { Direction } from '@/lib/creative/options';

const Body = z.object({ note: z.string().trim().min(3).max(300) });

/**
 * "طلب تعديل": closes this version (rejected, with the note) and generates a NEW revision with the same
 * account, product, format, language and creative direction plus the requested changes. Revisions are
 * linked through options.revisionOf so the ad page shows the full history.
 */
export const POST = api<{ params: Promise<{ id: string }> }>('ads:approve', async (req, { params, user }) => {
  const { id } = await params;
  const { note } = Body.parse(await req.json());
  const ad = await prisma.advertisement.findUniqueOrThrow({ where: { id } });
  if (!['QUALITY_REVIEW', 'APPROVED'].includes(ad.state)) throw new AppError('BAD_STATE', 'يمكن طلب التعديل قبل الإرسال إلى النشر فقط.', 409);
  await rejectAdvertisement(id, { id: user.sub, email: user.email }, `طلب تعديل: ${note}`);
  const opts = (ad.options ?? {}) as { direction?: Direction | null };
  const prev = opts.direction ?? {};
  const direction: Direction = { ...prev, idea: `${prev.idea ? prev.idea + '\n' : ''}تعديلات مطلوبة على النسخة السابقة: ${note}`.slice(-500) };
  const jobId = `rev-${randomUUID()}`;
  await enq.generate({ accountId: ad.accountId, productId: ad.productId, format: ad.format as MediaFormat, language: ad.language, direction, createdBy: user.email, revisionOf: id }, jobId);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'ad.request_changes', targetType: 'advertisement', targetId: id, details: { note, jobId } });
  return NextResponse.json({ jobId }, { status: 202 });
});
