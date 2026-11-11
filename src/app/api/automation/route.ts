import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { can } from '@/lib/auth/rbac';
import { getSettings, updateSettings } from '@/lib/settings';
import { audit, notify } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { prisma } from '@/lib/db';

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start') }),
  z.object({ action: z.literal('stop') }),
  z.object({ action: z.literal('kill'), reason: z.string().max(300).optional() }),
  z.object({ action: z.literal('release_kill') }),
  z.object({ action: z.literal('publishing_mode'), mode: z.enum(['MANUAL', 'ASSISTED', 'AUTONOMOUS']), confirm: z.string().optional() }),
  z.object({ action: z.literal('enable_accounts'), accountIds: z.array(z.string()).min(1).max(100), enabled: z.boolean().default(true) }),
  /** Bulk per-account settings: publishing interval (hours) and/or publish-without-approval (autonomous authorisation). */
  z.object({ action: z.literal('account_settings'), accountIds: z.array(z.string()).min(1).max(100), intervalHours: z.number().int().min(1).max(168).optional(), autonomous: z.boolean().optional() }),
  z.object({ action: z.literal('scheduler_mode'), mode: z.enum(['A_PER_ACCOUNT_HOURLY', 'B_FIXED_PER_HOUR']), postsPerHour: z.number().int().min(1).max(100).optional(), accountIds: z.array(z.string()).optional() }),
]);

export const GET = api('dashboard:view', async () => NextResponse.json(await getSettings()));

/** All automation switches. Every response returns the persisted settings so the UI shows confirmed backend state. */
export const POST = api('dashboard:view', async (req, { user }) => {
  const b = Body.parse(await req.json());
  const need = b.action === 'kill' || b.action === 'release_kill' ? 'killswitch:toggle' : (b.action === 'publishing_mode' && b.mode === 'AUTONOMOUS') || (b.action === 'account_settings' && b.autonomous) ? 'autonomy:authorize' : 'automation:control';
  if (!can(user.perms, need)) throw new AppError('FORBIDDEN', 'لا تملك الصلاحية', 403);
  let s;
  switch (b.action) {
    case 'start': {
      const cur = await getSettings();
      if (cur.killSwitch) throw new AppError('KILL_SWITCH_ACTIVE', 'مفتاح الإيقاف الطارئ مفعّل. ألغِه أولًا.', 423);
      const enabled = await prisma.socialAccount.count({ where: { autoPublishEnabled: true, connection: { status: 'CONNECTED', canPublish: true } } });
      if (!enabled) throw new AppError('NO_ACCOUNTS', 'لا توجد حسابات مرتبطة ومفعّل لها النشر الآلي. اختر الحسابات المسموح لها أولًا.', 412);
      s = await updateSettings((x) => ({ ...x, autoPublishGlobal: true }), user.email); break;
    }
    case 'enable_accounts': {
      // bulk "allow auto-publishing" — only for accounts with a verified publish connection; others are reported, not changed
      const accs = await prisma.socialAccount.findMany({ where: { id: { in: b.accountIds } }, include: { connection: true } });
      const ok = accs.filter((a) => !b.enabled || (a.connection?.status === 'CONNECTED' && a.connection.canPublish));
      await prisma.socialAccount.updateMany({ where: { id: { in: ok.map((a) => a.id) } }, data: { autoPublishEnabled: b.enabled } });
      const skipped = accs.filter((a) => !ok.includes(a)).map((a) => ({ name: a.name, reason: !a.connection ? 'غير مرتبط بـ Metricool' : `الربط: ${a.connection.status}${a.connection.canPublish ? '' : ' (بلا صلاحية نشر)'}` }));
      await audit({ actorId: user.sub, actorLabel: user.email, action: 'automation.enable_accounts', details: { enabled: b.enabled, changed: ok.map((a) => a.name), skipped } });
      return NextResponse.json({ ...(await getSettings()), changed: ok.length, skipped });
    }
    case 'account_settings': {
      const accs = await prisma.socialAccount.findMany({ where: { id: { in: b.accountIds } }, include: { connection: true } });
      const skipped: { name: string; reason: string }[] = [];
      let changed = 0;
      for (const a of accs) {
        const data: Record<string, unknown> = {};
        if (b.intervalHours) {
          data.publishIntervalMinutes = b.intervalHours * 60;
          data.maxDailyAds = Math.max(1, Math.ceil(24 / b.intervalHours)); // keep the daily cap consistent with the cadence
          if (a.nextPublishAt && a.nextPublishAt.getTime() > Date.now() + b.intervalHours * 3600_000) data.nextPublishAt = new Date(Date.now() + b.intervalHours * 3600_000); // a shorter interval applies soon, not after the old wait
        }
        if (b.autonomous !== undefined) {
          if (b.autonomous && !(a.connection?.status === 'CONNECTED' && a.connection.canPublish)) { skipped.push({ name: a.name, reason: 'غير مرتبط بـ Metricool — لا يمكن النشر بدون موافقة' }); }
          else Object.assign(data, { autonomousAuthorized: b.autonomous, autonomousAuthorizedAt: b.autonomous ? new Date() : null, autonomousAuthorizedBy: b.autonomous ? user.email : null });
        }
        if (Object.keys(data).length) { await prisma.socialAccount.update({ where: { id: a.id }, data }); changed++; }
      }
      await audit({ actorId: user.sub, actorLabel: user.email, action: 'automation.account_settings', details: { intervalHours: b.intervalHours ?? null, autonomous: b.autonomous ?? null, accounts: accs.map((a) => a.name), skipped } });
      const cur = await getSettings();
      const warning = b.autonomous && cur.publishingMode !== 'AUTONOMOUS' ? 'ملاحظة: وضع النشر ليس «ذاتي» — التصاميم ستذهب للموافقة حتى تختار الوضع الذاتي.' : undefined;
      return NextResponse.json({ ...cur, changed, skipped, warning });
    }
    case 'stop': s = await updateSettings((x) => ({ ...x, autoPublishGlobal: false }), user.email); break;
    case 'kill':
      s = await updateSettings((x) => ({ ...x, killSwitch: true, killSwitchReason: b.reason ?? null, autoPublishGlobal: false }), user.email);
      await notify('CRITICAL', 'KILL_SWITCH', 'تم تفعيل الإيقاف الطارئ', `بواسطة ${user.email}. ${b.reason ?? ''}`);
      break;
    case 'release_kill': s = await updateSettings((x) => ({ ...x, killSwitch: false, killSwitchReason: null }), user.email); break;
    case 'publishing_mode':
      if (b.mode === 'AUTONOMOUS' && b.confirm !== 'أوافق على النشر الذاتي') throw new AppError('CONFIRMATION_REQUIRED', 'يتطلب الوضع الذاتي كتابة عبارة التأكيد: أوافق على النشر الذاتي', 412);
      s = await updateSettings((x) => ({ ...x, publishingMode: b.mode, autonomousAuthorizedAt: b.mode === 'AUTONOMOUS' ? new Date().toISOString() : null, autonomousAuthorizedBy: b.mode === 'AUTONOMOUS' ? user.email : null }), user.email);
      break;
    case 'scheduler_mode':
      s = await updateSettings((x) => ({ ...x, schedulerMode: b.mode, modeBPostsPerHour: b.postsPerHour ?? x.modeBPostsPerHour, modeBAccountIds: b.accountIds ?? x.modeBAccountIds }), user.email);
      break;
  }
  await audit({ actorId: user.sub, actorLabel: user.email, action: `automation.${b.action}`, details: b });
  return NextResponse.json(s);
});
