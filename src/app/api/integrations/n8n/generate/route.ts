import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/db';
import { enq } from '@/lib/queue/queues';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { integrationApi } from '@/lib/integrations/auth';
import { DirectionSchema } from '@/lib/validation';

const Body = z.object({
  accountId: z.string().optional(), handle: z.string().optional(),
  format: z.enum(['IMAGE_STORY', 'IMAGE_FEED', 'IMAGE_SQUARE', 'REEL_VIDEO', 'IMAGE_CAROUSEL']).optional(),
  language: z.enum(['ar', 'en', 'ml']).optional(), productSlug: z.string().optional(),
  direction: DirectionSchema,
}).refine((b) => b.accountId || b.handle, 'accountId or handle is required');

/** POST — queue a new design (e.g. from a Google Sheet of ideas). It lands in the approval queue; nothing is published here. */
export const POST = integrationApi(async (req, { settings }) => {
  if (!settings.n8n.allowInboundGeneration) throw new AppError('FORBIDDEN', 'طلبات التوليد من n8n غير مسموحة في الإعدادات.', 403);
  const b = Body.parse(await req.json());
  const acc = await prisma.socialAccount.findFirstOrThrow({ where: b.accountId ? { id: b.accountId } : { handle: b.handle!.replace(/^@/, '') } });
  const product = b.productSlug ? await prisma.product.findFirstOrThrow({ where: { slug: b.productSlug, active: true } }) : null;
  const jobId = `n8n-${randomUUID()}`;
  await enq.generate({ accountId: acc.id, productId: product?.id, format: b.format, language: b.language, direction: b.direction, createdBy: 'n8n' }, jobId);
  await audit({ actorLabel: 'n8n', action: 'ad.generate.request', targetType: 'social_account', targetId: acc.id, details: { format: b.format ?? null, idea: b.direction?.idea ?? null } });
  return NextResponse.json({ jobId, accountId: acc.id, status: 'queued', note: 'التصميم سيصل إلى طابور الموافقات' }, { status: 202 });
});
