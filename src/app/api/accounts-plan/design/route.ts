import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { prisma } from '@/lib/db';
import { enq } from '@/lib/queue/queues';
import { audit } from '@/lib/audit';
import { rateLimit } from '@/lib/security/rate-limit';
import { AppError } from '@/lib/errors';
import { OCCASIONS } from '@/lib/creative/options';
import { approvePlanIdeas, planIdeasByKey } from '@/lib/growth/account-plan';

/** «صمّم الآن»: one plan idea → the idea bank (USED) → a design job; it lands in the approval queue in a minute or two */
export const POST = api('ads:create', async (req, { user }) => {
  const rl = await rateLimit(`gen:${user.sub}`, 20, 3600);
  if (!rl.ok) throw new AppError('RATE_LIMITED', 'تم تجاوز عدد طلبات التوليد المسموح بها في الساعة.', 429);
  const b = z.object({ accountId: z.string().max(40), key: z.string().max(60) }).parse(await req.json());
  const [idea] = await planIdeasByKey(b.accountId, [b.key]);
  const { ids: [id] } = await approvePlanIdeas(b.accountId, [idea], user);
  const row = await prisma.idea.findUniqueOrThrow({ where: { id } });
  const claimed = await prisma.idea.updateMany({ where: { id, status: { in: ['NEW', 'APPROVED'] } }, data: { status: 'USED' } });
  if (!claimed.count) throw new AppError('USED', 'هذه الفكرة صُمّمت مسبقًا', 409);
  await enq.generate({
    accountId: row.accountId, productId: row.productId, createdBy: user.email, language: row.language as 'ar' | 'en' | 'ml',
    ...(row.format ? { format: row.format as 'REEL_VIDEO' } : {}),
    direction: { idea: [row.title, row.idea, row.hook ? `Hook: ${row.hook}` : ''].filter(Boolean).join(' — ').slice(0, 500), ...(row.occasion && OCCASIONS.some((o) => o.value === row.occasion) ? { occasion: row.occasion as never } : {}) },
  }, `plan-${id}`);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'plan.idea.design', targetType: 'idea', targetId: id, details: { accountId: b.accountId, key: b.key } });
  return NextResponse.json({ ok: true, message: 'بدأ التصميم — ستجده في طابور الموافقات خلال دقيقة أو اثنتين' });
});
