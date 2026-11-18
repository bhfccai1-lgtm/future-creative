import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { sendReply } from '@/lib/comments/service';

/** A person sends (or records) the reply — never automatic. */
export const POST = api<{ params: Promise<{ id: string }> }>('publish:now', async (req, { params, user }) => {
  const { text } = z.object({ text: z.string().min(1).max(600) }).parse(await req.json());
  return NextResponse.json(await sendReply((await params).id, text, user));
});
