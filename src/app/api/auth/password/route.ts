import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api, clientIp } from '@/lib/auth/server';
import { changeOwnPassword } from '@/lib/auth/users';
import { rateLimit } from '@/lib/security/rate-limit';
import { SESSION_COOKIE } from '@/lib/auth/session';
import { AppError } from '@/lib/errors';

/** change my own password — every session ends (this one too), so the client goes back to the login page */
export const POST = api('dashboard:view', async (req, { user }) => {
  const rl = await rateLimit(`pwchange:${user.sub}:${(await clientIp()) ?? '-'}`, 5, 900);
  if (!rl.ok) throw new AppError('RATE_LIMIT', 'محاولات كثيرة — حاول بعد قليل.', 429);
  const { current, next } = z.object({ current: z.string().min(1).max(200), next: z.string().min(1).max(200) }).parse(await req.json());
  await changeOwnPassword(user, current, next);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
});
