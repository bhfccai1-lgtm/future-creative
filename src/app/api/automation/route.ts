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
  z.object({ action: z.literal('scheduler_mode'), mode: z.enum(['A_PER_ACCOUNT_HOURLY', 'B_FIXED_PER_HOUR']), postsPerHour: z.number().int().min(1).max(100).optional(), accountIds: z.array(z.string()).optional() }),
]);

export const GET = api('dashboard:view', async () => NextResponse.json(await getSettings()));

/** All automation switches. Every response returns the persisted settings so the UI shows confirmed backend state. */
export const POST = api('dashboard:view', async (req, { user }) => {
  const b = Body.parse(await req.json());
  const need = b.action === 'kill' || b.action === 'release_kill' ? 'killswitch:toggle' : b.action === 'publishing_mode' && b.mode === 'AUTONOMOUS' ? 'autonomy:authorize' : 'automation:control';
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
