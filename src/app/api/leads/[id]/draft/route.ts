import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { smartReply } from '@/lib/leads/intel';

/** ✨ the next WhatsApp message written for this customer (one small AI text call; the ready script without a key). Nothing is sent. */
export const POST = api<{ params: Promise<{ id: string }> }>('ads:approve', async (_req, { params }) => {
  const r = await smartReply((await params).id);
  return NextResponse.json({ ok: true, ...r, message: r.source === 'ai' ? 'صيغت رسالة مخصصة لهذا العميل — راجعها قبل الإرسال' : 'لا يوجد مفتاح ذكاء اصطناعي — استُخدمت الرسالة الجاهزة' });
});
