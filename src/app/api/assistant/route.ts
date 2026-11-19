import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { rateLimit } from '@/lib/security/rate-limit';
import { AppError } from '@/lib/errors';
import { chat } from '@/lib/assistant/agent';

const Body = z.object({
  message: z.string().min(1).max(1500),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(3000) })).max(20).default([]),
});
export const POST = api('dashboard:view', async (req, { user }) => {
  const rl = await rateLimit(`assistant:${user.sub}`, 40, 3600);
  if (!rl.ok) throw new AppError('RATE_LIMITED', 'رسائل كثيرة خلال ساعة — حاول بعد قليل.', 429);
  const b = Body.parse(await req.json());
  return NextResponse.json(await chat(user, b.history, b.message));
});
