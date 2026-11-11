import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { getSecret } from '@/lib/settings';
import { AppError } from '@/lib/errors';

/**
 * Finds the chat id and the user id after the owner sends any message to the bot (or adds it to a group):
 * reads the bot's recent updates (Telegram getUpdates). Read-only; nothing is sent.
 */
export const POST = api('settings:integrations', async () => {
  const token = await getSecret('TELEGRAM_BOT_TOKEN');
  if (!token) throw new AppError('NOT_CONFIGURED', 'احفظ رمز البوت أولًا.', 412);
  let r: Response;
  try { r = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=50`, { signal: AbortSignal.timeout(10_000) }); }
  catch (e) { throw new AppError('NETWORK', `تعذر الاتصال بتيليجرام: ${(e as Error).message}`, 502); }
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: { message?: { chat: { id: number; title?: string; first_name?: string; type: string }; from?: { id: number; first_name?: string; username?: string } }; my_chat_member?: { chat: { id: number; title?: string; type: string }; from?: { id: number; first_name?: string; username?: string } } }[] };
  if (!j.ok) throw new AppError('TELEGRAM', j.description?.includes('Conflict') ? 'البوت مربوط حاليًا بـ n8n (webhook) — رقم المحادثة يُكتشف قبل تفعيل قالب البوت، أو أدخله يدويًا.' : `تيليجرام رفض الطلب: ${j.description ?? r.status}`, 502);
  const chats = new Map<number, { id: string; name: string; type: string }>();
  const users = new Map<number, { id: string; name: string }>();
  for (const u of j.result ?? []) {
    const m = u.message ?? u.my_chat_member;
    if (!m) continue;
    chats.set(m.chat.id, { id: String(m.chat.id), name: m.chat.title ?? (m.chat as { first_name?: string }).first_name ?? '', type: m.chat.type });
    if (m.from) users.set(m.from.id, { id: String(m.from.id), name: m.from.username ? `@${m.from.username}` : m.from.first_name ?? '' });
  }
  if (!chats.size) return NextResponse.json({ chats: [], users: [], hint: 'أرسل أي رسالة للبوت (أو أضفه لمجموعتك واكتب فيها) ثم اضغط مرة أخرى.' });
  return NextResponse.json({ chats: [...chats.values()], users: [...users.values()] });
});
