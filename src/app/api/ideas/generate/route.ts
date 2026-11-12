import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { generateIdeas } from '@/lib/ideas/bank';
import { rateLimit } from '@/lib/security/rate-limit';
import { AppError } from '@/lib/errors';
import { AiProviderError } from '@/lib/ai/types';

const Body = z.object({ accountId: z.string(), productId: z.string().optional(), count: z.number().int().min(1).max(6).optional() });
/** «ولّد أفكارًا الآن»: rated ideas for one account into the bank (one small text call). */
export const POST = api('ads:create', async (req, { user }) => {
  const rl = await rateLimit(`ideas-bank:${user.sub}`, 40, 3600);
  if (!rl.ok) throw new AppError('RATE_LIMITED', 'تم تجاوز عدد طلبات توليد الأفكار في الساعة.', 429);
  const b = Body.parse(await req.json());
  try {
    const ideas = await generateIdeas(b.accountId, { productId: b.productId, count: b.count, source: 'manual', actor: user.email });
    return NextResponse.json({ ok: true, created: ideas.length });
  } catch (e) {
    if (e instanceof AiProviderError) throw new AppError(`AI_${e.code}`, e.message, 502);
    throw e;
  }
});
