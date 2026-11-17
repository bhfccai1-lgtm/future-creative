import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { importComments } from '@/lib/comments/service';

const Body = z.object({ accountId: z.string().min(1), text: z.string().min(2).max(60_000) });
/** Comments pasted by the owner (no Meta token needed): one comment per line, «username: text» optional. */
export const POST = api('ads:create', async (req, { user }) => {
  const b = Body.parse(await req.json());
  return NextResponse.json(await importComments(b.accountId, b.text, user.email));
});
