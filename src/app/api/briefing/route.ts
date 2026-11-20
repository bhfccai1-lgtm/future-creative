import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { can } from '@/lib/auth/rbac';
import { AppError } from '@/lib/errors';
import { updateSettings } from '@/lib/settings';
import { audit } from '@/lib/audit';
import { runMorningBrief } from '@/lib/ops/briefing';

/** «حدّث الموجز الآن» — builds today's brief (free unless the AI phrasing is switched on) */
export const POST = api('dashboard:view', async () => {
  const r = await runMorningBrief(new Date(), async () => ({ ok: false })); // a manual refresh never messages WhatsApp
  return NextResponse.json({ ok: true, message: 'skipped' in r ? 'الموجز متوقف من الإعدادات' : 'تم تحديث موجز اليوم ✓' });
});

const Body = z.object({ enabled: z.boolean(), aiWrite: z.boolean(), whatsapp: z.boolean() });
export const PUT = api('dashboard:view', async (req, { user }) => {
  if (!can(user.perms, 'automation:control')) throw new AppError('FORBIDDEN', 'لا تملك صلاحية تغيير الإعدادات.', 403);
  const b = Body.parse(await req.json());
  const s = await updateSettings((x) => ({ ...x, briefing: b }), user.email);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'settings.briefing', details: b });
  return NextResponse.json({ ok: true, briefing: s.briefing });
});
