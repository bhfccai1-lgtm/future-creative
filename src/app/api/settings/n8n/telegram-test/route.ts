import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { getSecret, getSettings } from '@/lib/settings';
import { AppError } from '@/lib/errors';

/** Sends one message straight from the system to Telegram (bypassing n8n), so a bad token / chat id / unstarted bot shows a clear reason. */
export const POST = api('settings:integrations', async () => {
  const token = await getSecret('TELEGRAM_BOT_TOKEN');
  if (!token) throw new AppError('NOT_CONFIGURED', 'احفظ رمز البوت أولًا.', 412);
  const chat = (await getSettings()).n8n.telegramChatId.trim();
  if (!chat) throw new AppError('NOT_CONFIGURED', 'أدخل رقم المحادثة واحفظ أولًا.', 412);
  let r: Response;
  try {
    r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ chat_id: chat, text: '✅ اختبار مباشر من نظام مطبعة إبداع المستقبل — رمز البوت ورقم المحادثة صحيحان.' }),
    });
  } catch (e) { throw new AppError('NETWORK', `تعذر الاتصال بتيليجرام من السيرفر: ${(e as Error).message}`, 502); }
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  if (j.ok) return NextResponse.json({ ok: true });
  const d = j.description ?? `HTTP ${r.status}`;
  const why = /chat not found/i.test(d) ? 'رقم المحادثة خطأ، أو لم تضغط «Start» في محادثة البوت. افتح البوت في تيليجرام واضغط Start ثم «اكتشاف تلقائي».'
    : /blocked/i.test(d) ? 'لقد حظرت البوت في تيليجرام — ألغِ الحظر واضغط Start.'
    : /unauthorized/i.test(d) ? 'رمز البوت غير صحيح أو أُلغي — أنشئ رمزًا جديدًا من @BotFather واحفظه.'
    : /can't initiate/i.test(d) ? 'البوت لا يستطيع بدء المحادثة — افتح البوت واضغط Start أولًا.'
    : `تيليجرام رفض: ${d}`;
  throw new AppError('TELEGRAM', why, 502);
});
