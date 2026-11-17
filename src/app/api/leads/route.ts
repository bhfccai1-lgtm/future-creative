import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { createLead } from '@/lib/leads/service';

const Body = z.object({
  name: z.string().max(80).nullish(), contact: z.string().max(80).nullish(), need: z.string().trim().min(2).max(500),
  source: z.string().max(20).default('phone'), accountId: z.string().max(60).nullish(), productId: z.string().max(60).nullish(), notes: z.string().max(1000).nullish(),
});
/** Add a customer inquiry by hand (phone, WhatsApp, branch visit…). */
export const POST = api('ads:approve', async (req, { user }) => {
  const b = Body.parse(await req.json());
  const lead = await createLead({ ...b, accountId: b.accountId || null, productId: b.productId || null }, user);
  return NextResponse.json({ ok: true, id: lead.id, message: 'أُضيف العميل ✓' });
});
