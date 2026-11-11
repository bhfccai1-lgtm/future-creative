import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import type { MediaFormat } from '@prisma/client';
import { api } from '@/lib/auth/server';
import { prisma } from '@/lib/db';
import { enq } from '@/lib/queue/queues';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import type { Direction } from '@/lib/creative/options';

/** A FAILED design: generate it again with exactly the same account, product, format, language and direction. */
export const POST = api<{ params: Promise<{ id: string }> }>('ads:create', async (_req, { params, user }) => {
  const { id } = await params;
  const ad = await prisma.advertisement.findUniqueOrThrow({ where: { id } });
  if (ad.state !== 'FAILED') throw new AppError('BAD_STATE', 'إعادة التوليد متاحة للتصاميم الفاشلة فقط — استخدم «طلب تعديل» للتصاميم الأخرى.', 409);
  const opts = (ad.options ?? {}) as { direction?: Direction | null };
  const { autoPicked: _a, ...direction } = opts.direction ?? {};
  void _a;
  const jobId = `regen-${randomUUID()}`;
  await enq.generate({ accountId: ad.accountId, productId: ad.productId, format: ad.format as MediaFormat, language: ad.language, direction: Object.keys(direction).length ? direction : undefined, createdBy: user.email, revisionOf: id }, jobId);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'ad.regenerate', targetType: 'advertisement', targetId: id, details: { jobId } });
  return NextResponse.json({ jobId }, { status: 202 });
});
