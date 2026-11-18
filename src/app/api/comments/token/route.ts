import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { audit } from '@/lib/audit';
import { getSecret, getSettings, secretStatus, setSecret } from '@/lib/settings';
import { InstagramComments } from '@/lib/comments/instagram';
import { prisma } from '@/lib/db';

/** Save (encrypted, write-only) / remove the Meta token used for comments. */
export const PUT = api('settings:integrations', async (req, { user }) => {
  const { token } = z.object({ token: z.string().max(1000) }).parse(await req.json());
  await setSecret('META_COMMENTS_TOKEN', token === '__delete__' ? null : token.trim(), user.email);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'settings.comments_token', details: { removed: token === '__delete__' } });
  return NextResponse.json(await secretStatus('META_COMMENTS_TOKEN'));
});

/** Connection test: which Instagram accounts the token reaches, and which of them match our accounts. */
export const POST = api('settings:integrations', async () => {
  const token = await getSecret('META_COMMENTS_TOKEN');
  if (!token) return NextResponse.json({ ok: false, message: 'احفظ الرمز أولًا.' });
  try {
    const list = await new InstagramComments({ token, version: (await getSettings()).whatsapp.catalog.graphVersion }).accounts();
    const ours = (await prisma.socialAccount.findMany({ where: { handle: { not: null } }, select: { handle: true } })).map((a) => a.handle!.replace(/^@/, '').toLowerCase());
    const matched = list.filter((a) => ours.includes(a.username.toLowerCase())).map((a) => a.username);
    return NextResponse.json({ ok: list.length > 0, message: list.length ? `متصل ✓ — ${list.length} حساب انستغرام، ${matched.length} منها مطابق لحساباتك${list.length > matched.length ? ` (غير مطابق: ${list.filter((a) => !matched.includes(a.username)).map((a) => a.username).join('، ')})` : ''}` : 'الرمز صالح لكن لا يصل لأي حساب انستغرام أعمال — أضف الصفحات للمستخدم في إعدادات الأعمال.' });
  } catch (e) { return NextResponse.json({ ok: false, message: `فشل الاتصال: ${(e as Error).message.slice(0, 200)}` }); }
});
