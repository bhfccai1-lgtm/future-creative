import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { prisma } from '@/lib/db';
import { enq } from '@/lib/queue/queues';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { OCCASIONS } from '@/lib/creative/options';

/** «صمّم الآن»: generates a design from this idea (normal approval/autonomy rules apply). */
export const POST = api<{ params: Promise<{ id: string }> }>('ads:create', async (_req, { params, user }) => {
  const { id } = await params;
  const idea = await prisma.idea.findUnique({ where: { id }, include: { account: { select: { formatStrategy: true, publishFormat: true } } } });
  if (!idea) throw new AppError('NOT_FOUND', 'الفكرة غير موجودة', 404);
  const claimed = await prisma.idea.updateMany({ where: { id, status: { in: ['NEW', 'APPROVED'] } }, data: { status: 'USED' } });
  if (!claimed.count) throw new AppError('USED', 'هذه الفكرة استُخدمت أو رُفضت', 409);
  await enq.generate({
    accountId: idea.accountId, productId: idea.productId, createdBy: user.email, language: idea.language as 'ar' | 'en' | 'ml',
    ...(idea.format ? { format: idea.format } : {}),
    direction: { idea: [idea.title, idea.idea, idea.hook ? `Hook: ${idea.hook}` : ''].filter(Boolean).join(' — ').slice(0, 500), ...(idea.occasion && OCCASIONS.some((o) => o.value === idea.occasion) ? { occasion: idea.occasion } : {}) },
  }, `idea-${id}`);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'ideas.use', targetType: 'idea', targetId: id });
  return NextResponse.json({ ok: true, message: 'بدأ التصميم — ستجده في طابور الموافقات خلال دقيقة أو اثنتين' });
});
