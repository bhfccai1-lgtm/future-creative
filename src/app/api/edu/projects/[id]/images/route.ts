import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { generateImages, imagePlan } from '@/lib/edu/service';
import { rateLimit } from '@/lib/security/rate-limit';
import { AppError } from '@/lib/errors';
import { eduUser } from '../../../_user';
type P = { params: Promise<{ id: string }> };
/** The planned AI pictures and their estimated cost. */
export const GET = api<P>('ads:create', async (_req, { params, user }) => NextResponse.json(await imagePlan((await params).id, eduUser(user))));
/** Generate the missing pictures (or `only` the given slots again). */
export const POST = api<P>('ads:create', async (req, { params, user }) => {
  const rl = await rateLimit(`edu-img:${user.sub}`, 40, 3600);
  if (!rl.ok) throw new AppError('RATE_LIMITED', 'طلبات صور كثيرة خلال الساعة — حاول لاحقًا.', 429);
  const { only } = z.object({ only: z.array(z.string().max(60)).max(20).optional() }).parse(await req.json().catch(() => ({})));
  const r = await generateImages((await params).id, eduUser(user), { only });
  return NextResponse.json({ ok: true, generated: r.generated, failed: r.failed, message: r.failed.length ? `تم ${r.generated} صورة — تعذّر ${r.failed.length}` : `تم توليد ${r.generated} صورة ✓` });
});
