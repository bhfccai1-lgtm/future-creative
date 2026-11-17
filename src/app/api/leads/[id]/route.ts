import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { STATUSES, STATUS_AR, updateLead } from '@/lib/leads/service';

const Body = z.object({
  status: z.enum(STATUSES).optional(), valueBhd: z.union([z.number(), z.string().max(20)]).nullish(), lostReason: z.string().max(120).nullish(),
  followUpDays: z.coerce.number().int().min(0).max(60).nullish(), notes: z.string().max(1000).nullish(), accountId: z.string().max(60).nullish(), productId: z.string().max(60).nullish(),
});
export const PATCH = api<{ params: Promise<{ id: string }> }>('ads:approve', async (req, { params, user }) => {
  const b = Body.parse(await req.json());
  const lead = await updateLead((await params).id, b, user);
  return NextResponse.json({ ok: true, message: b.status ? `${STATUS_AR[lead.status as keyof typeof STATUS_AR]}${lead.status === 'WON' && lead.valueBhd ? ` — ${lead.valueBhd} د.ب` : ''}` : 'حُفظ ✓' });
});
