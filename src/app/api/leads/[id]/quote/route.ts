import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { saveQuote } from '@/lib/leads/service';

const Body = z.object({
  items: z.array(z.object({ desc: z.string().max(120), qty: z.coerce.number().min(0).max(1_000_000), unit: z.coerce.number().min(0).max(100_000) })).min(1).max(30),
  discount: z.coerce.number().min(0).max(1_000_000).default(0), notes: z.string().max(500).default(''),
});
/** Save the quote the owner typed (items, quantities, prices) — numbered, valid for the configured days. */
export const PUT = api<{ params: Promise<{ id: string }> }>('ads:approve', async (req, { params, user }) => {
  const lead = await saveQuote((await params).id, Body.parse(await req.json()), user);
  return NextResponse.json({ ok: true, quoteNo: lead.quoteNo, message: `حُفظ عرض السعر رقم ${lead.quoteNo} ✓` });
});
