import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { syncComments } from '@/lib/comments/service';
import { rateLimit } from '@/lib/security/rate-limit';
import { AppError } from '@/lib/errors';

/** Pull new comments from Instagram (official API) and analyse them. */
export const POST = api('ads:create', async (_req, { user }) => {
  if (!(await rateLimit(`comments-sync:${user.sub}`, 20, 3600)).ok) throw new AppError('RATE_LIMITED', 'مزامنات كثيرة خلال الساعة — حاول بعد قليل.', 429);
  const r = await syncComments();
  if ('skipped' in r && r.skipped === 'NO_TOKEN') throw new AppError('NO_TOKEN', 'احفظ رمز Meta للتعليقات أولًا (قسم «الربط مع انستغرام»).', 412);
  return NextResponse.json(r);
});
