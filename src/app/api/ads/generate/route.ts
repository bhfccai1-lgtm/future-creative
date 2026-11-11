import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { api } from '@/lib/auth/server';
import { enq } from '@/lib/queue/queues';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { rateLimit } from '@/lib/security/rate-limit';
import { AppError } from '@/lib/errors';
import { DirectionSchema } from '@/lib/validation';

const Body = z.object({
  accountId: z.string(), productId: z.string().optional(),
  format: z.enum(['IMAGE_STORY', 'IMAGE_FEED', 'IMAGE_SQUARE', 'REEL_VIDEO', 'IMAGE_CAROUSEL']).optional(),
  language: z.enum(['ar', 'en', 'ml']).optional(),
  direction: DirectionSchema,
});

/** "إنشاء إعلان الآن" — enqueues a generation job on the worker (generation can take a minute). */
export const POST = api('ads:create', async (req, { user }) => {
  const rl = await rateLimit(`gen:${user.sub}`, 20, 3600);
  if (!rl.ok) throw new AppError('RATE_LIMITED', 'تم تجاوز عدد طلبات التوليد المسموح بها في الساعة.', 429);
  const b = Body.parse(await req.json());
  await prisma.socialAccount.findUniqueOrThrow({ where: { id: b.accountId } });
  const jobId = `manual-${randomUUID()}`;
  await enq.generate({ accountId: b.accountId, productId: b.productId, format: b.format, language: b.language, direction: b.direction, createdBy: user.email }, jobId);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'ad.generate.request', targetType: 'social_account', targetId: b.accountId, details: b });
  return NextResponse.json({ jobId }, { status: 202 });
});
