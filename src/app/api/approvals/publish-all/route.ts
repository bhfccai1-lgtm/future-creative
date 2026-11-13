import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { prisma } from '@/lib/db';
import { publishNow } from '@/lib/publishing/jobs';
import { audit } from '@/lib/audit';

/**
 * «اعتماد ونشر كل الجاهز»: every pending design that passed QC (and is not a trial) goes through the SAME path as
 * the single «نشر» button — approval binding, the 30-minute gap per account, kill switch and connection checks.
 * Anything that fails a check is skipped and reported, never forced.
 */
export const POST = api('publish:now', async (_req, { user }) => {
  const pending = await prisma.approvalRequest.findMany({ where: { status: 'PENDING', advertisement: { qcPassed: true, dryRun: false, state: 'QUALITY_REVIEW' } }, orderBy: { createdAt: 'asc' }, select: { advertisementId: true } });
  let ok = 0; const skipped: string[] = [];
  for (const p of pending) {
    try { await publishNow(p.advertisementId, { id: user.sub, email: user.email }); ok++; }
    catch (e) { skipped.push((e as Error).message.slice(0, 80)); }
  }
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'approvals.publish_all', details: { ok, skipped: skipped.length } });
  return NextResponse.json({ ok: true, published: ok, skipped: skipped.length, message: `أُرسل ${ok} تصميم للنشر (بفاصل 30 دقيقة لكل حساب)${skipped.length ? ` · تُخطّي ${skipped.length}: ${[...new Set(skipped)].slice(0, 2).join('؛ ')}` : ''}` });
});
