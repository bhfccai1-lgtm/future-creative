import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { can } from '@/lib/auth/rbac';
import { AppError } from '@/lib/errors';
import { updateSettings } from '@/lib/settings';
import { audit } from '@/lib/audit';
import { runTrendRadar } from '@/lib/growth/trends';

/** «حدّث الآن» — reads today's trends (and, with an AI key, makes ideas: one small text call) */
export const POST = api('ads:create', async () => {
  const r = await runTrendRadar({ force: true });
  if ('skipped' in r) return NextResponse.json({ ok: true, message: 'الرادار متوقف' });
  const n = Object.values(r.geos).flat().length;
  return NextResponse.json({ ok: true, message: r.error && !n ? `تعذّر جلب الترند: ${r.error}` : `${n} ترند آمن · ${r.blocked} استُبعد · ${r.ideas} فكرة جديدة`, radar: r });
});

const Body = z.object({ enabled: z.boolean(), geos: z.array(z.enum(['BH', 'SA', 'AE', 'KW', 'QA', 'OM'])).min(1).max(6), ideasPerDay: z.number().int().min(1).max(10) });
/** on/off + countries (the daily run at 06:20 Bahrain time) */
export const PUT = api('ads:create', async (req, { user }) => {
  if (!can(user.perms, 'automation:control')) throw new AppError('FORBIDDEN', 'لا تملك صلاحية تغيير الجدول الآلي.', 403);
  const b = Body.parse(await req.json());
  const s = await updateSettings((x) => ({ ...x, trends: b }), user.email);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'settings.trends', details: b });
  return NextResponse.json({ ok: true, trends: s.trends });
});
