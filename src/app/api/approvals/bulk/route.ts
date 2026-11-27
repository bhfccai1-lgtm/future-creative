import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { prisma } from '@/lib/db';
import { publishNow, rejectAdvertisement } from '@/lib/publishing/jobs';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { can } from '@/lib/auth/rbac';

const Body = z.object({ action: z.enum(['publish', 'reject']), ids: z.array(z.string().min(1).max(40)).min(1).max(60), note: z.string().max(500).optional() });

/**
 * Bulk decisions from the approval queue. Each design goes through the SAME path as its single button
 * (approval binding, the 30-minute gap per account, kill switch, connection checks). Bulk publishing NEVER overrides
 * quality: a design that did not pass QC is skipped and reported — overriding stays a per-design, audited decision.
 */
export const POST = api('ads:approve', async (req, { user }) => {
  const b = Body.parse(await req.json());
  if (b.action === 'publish' && !can(user.perms, 'publish:now')) throw new AppError('FORBIDDEN', 'لا تملك صلاحية النشر.', 403);
  const pending = await prisma.approvalRequest.findMany({ where: { status: 'PENDING', advertisementId: { in: b.ids } }, select: { advertisementId: true, advertisement: { select: { qcPassed: true, dryRun: true, state: true } } } });
  const actor = { id: user.sub, email: user.email };
  let ok = 0; const skipped: string[] = [];
  for (const p of pending) {
    try {
      if (b.action === 'publish') {
        const a = p.advertisement;
        if (!a.qcPassed || a.dryRun || a.state !== 'QUALITY_REVIEW') { skipped.push(a.dryRun ? 'تصميم تجريبي' : 'لم يجتز فحص الجودة — انشره منفردًا بعد مراجعته'); continue; }
        await publishNow(p.advertisementId, actor);
      } else await rejectAdvertisement(p.advertisementId, actor, b.note);
      ok++;
    } catch (e) { skipped.push((e as Error).message.slice(0, 80)); }
  }
  const gone = b.ids.length - pending.length; // already decided elsewhere
  await audit({ actorId: user.sub, actorLabel: user.email, action: `approvals.bulk_${b.action}`, details: { requested: b.ids.length, ok, skipped: skipped.length, gone } });
  const verb = b.action === 'publish' ? 'أُرسل للنشر' : 'رُفض';
  const why = [...new Set(skipped)].slice(0, 2).join('؛ ');
  return NextResponse.json({ ok: true, done: ok, skipped: skipped.length, message: `${verb} ${ok} تصميم${b.action === 'publish' ? ' (بفاصل 30 دقيقة لكل حساب)' : ''}${skipped.length ? ` · تُخطّي ${skipped.length}: ${why}` : ''}${gone ? ` · ${gone} قُرّر مسبقًا` : ''}` });
});
