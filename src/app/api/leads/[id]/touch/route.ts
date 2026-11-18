import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { recordTouch } from '@/lib/leads/service';
import { SCRIPT_AR } from '@/lib/leads/scripts';

const Body = z.object({ key: z.enum(['first_reply', 'quote_send', 'follow_1', 'follow_2', 'won_thanks', 'reactivate', 'reengage']) });
/** Logs a playbook message a person sent from WhatsApp and advances the customer's stage. */
export const POST = api<{ params: Promise<{ id: string }> }>('ads:approve', async (req, { params, user }) => {
  const { key } = Body.parse(await req.json());
  await recordTouch((await params).id, key, user);
  return NextResponse.json({ ok: true, message: `سُجّل: ${SCRIPT_AR[key]} ✓` });
});
