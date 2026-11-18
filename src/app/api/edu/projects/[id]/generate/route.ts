import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { generate } from '@/lib/edu/service';
import { rateLimit } from '@/lib/security/rate-limit';
import { AppError } from '@/lib/errors';
import { eduUser } from '../../../_user';
export const POST = api<{ params: Promise<{ id: string }> }>('ads:create', async (_req, { params, user }) => {
  const rl = await rateLimit(`edu-gen:${user.sub}`, 30, 3600);
  if (!rl.ok) throw new AppError('RATE_LIMITED', 'طلبات كثيرة خلال الساعة — حاول لاحقًا.', 429);
  const p = await generate((await params).id, eduUser(user));
  return NextResponse.json({ ok: true, project: p, message: p.source === 'ai' ? 'أُنشئ المحتوى ✓ — راجعه وعدّله قبل الاعتماد' : 'أُنشئ محتوى نموذجي (لا يوجد مفتاح ذكاء اصطناعي) — أكمله يدويًا' });
});
