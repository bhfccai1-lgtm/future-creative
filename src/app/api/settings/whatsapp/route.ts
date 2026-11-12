import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { setSecret, updateSettings } from '@/lib/settings';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { QUEUE, queue } from '@/lib/queue/queues';
import { testCatalog, whatsappStatus } from '@/lib/integrations/whatsapp-catalog';
import { sendStatusPacks } from '@/lib/integrations/whatsapp-status';

const status = whatsappStatus;
export const GET = api('settings:integrations', async () => NextResponse.json(await status()));

const Body = z.object({
  catalog: z.object({ enabled: z.boolean(), catalogId: z.string().trim().regex(/^\d{0,30}$/, 'رقم الكتالوج أرقام فقط'), categoryIds: z.array(z.string()).max(200), autoSyncDaily: z.boolean(), graphVersion: z.string().regex(/^v\d+\.\d+$/).optional() }).optional(),
  statusPack: z.object({ enabled: z.boolean(), maxPerDay: z.number().int().min(1).max(10), accountIds: z.array(z.string()).max(50) }).optional(),
  /** Meta system-user token (catalog_management). "__delete__" removes it. Never returned to the browser. */
  token: z.string().max(1000).optional(),
});
export const PUT = api('settings:integrations', async (req, { user }) => {
  const b = Body.parse(await req.json());
  if (b.token === '__delete__') await setSecret('META_CATALOG_TOKEN', null, user.email);
  else if (b.token?.trim()) {
    if (!/^EA[A-Za-z0-9]{40,}$/.test(b.token.trim())) throw new AppError('VALIDATION', 'رمز Meta غير صحيح — يبدأ عادة بـ EA (انسخه كاملًا من Business Settings ← System users)', 422);
    await setSecret('META_CATALOG_TOKEN', b.token.trim(), user.email);
  }
  await updateSettings((s) => ({ ...s, whatsapp: {
    catalog: b.catalog ? { ...s.whatsapp.catalog, ...b.catalog } : s.whatsapp.catalog,
    statusPack: b.statusPack ?? s.whatsapp.statusPack,
  } }), user.email);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'settings.whatsapp', details: { catalog: b.catalog?.enabled ?? null, statusPack: b.statusPack?.enabled ?? null, token: b.token ? (b.token === '__delete__' ? 'deleted' : 'set') : 'unchanged' } });
  return NextResponse.json(await status());
});

/** action: test (read the catalogue name), sync (queued on the worker), status_test (send one status pack to Telegram now). */
export const POST = api('settings:integrations', async (req, { user }) => {
  const { action } = z.object({ action: z.enum(['test', 'sync', 'status_test']) }).parse(await req.json());
  try {
    if (action === 'test') return NextResponse.json({ ok: true, ...(await testCatalog()) });
    if (action === 'sync') {
      await queue(QUEUE.scheduler).add('wa-catalog', { actor: user.email }, { jobId: `wa-catalog-${Math.floor(Date.now() / 60_000)}`, removeOnComplete: 50, removeOnFail: 50 });
      return NextResponse.json({ ok: true, queued: true });
    }
    const r = await sendStatusPacks({ force: true });
    if (!r.sent) throw new AppError('NOTHING', r.reason === 'telegram_not_configured' ? 'اربط بوت تيليجرام ورقم المحادثة أولًا (إعدادات n8n).' : 'لا يوجد منشور مؤكد جديد خلال آخر 24 ساعة لم يُرسل من قبل.', 412);
    return NextResponse.json({ ok: true, sent: r.sent });
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('WHATSAPP', (e as Error).message, 502);
  }
});
