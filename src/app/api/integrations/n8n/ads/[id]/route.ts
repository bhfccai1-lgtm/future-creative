import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { integrationApi } from '@/lib/integrations/auth';
import { signedMediaUrl } from '@/lib/storage';
import { qcVerdict, type QcReport } from '@/lib/qc';
import { publishableMedia } from '@/lib/publishing/media';

/** GET — one design: caption, QC verdict + failed checks, publishable media links, publication status. */
export const GET = integrationApi<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const { id } = await params;
  const a = await prisma.advertisement.findUniqueOrThrow({ where: { id }, include: { account: { select: { name: true } }, media: true, jobs: { include: { result: true }, orderBy: { createdAt: 'desc' }, take: 1 } } });
  const qc = a.qcReport as unknown as QcReport | null;
  const job = a.jobs[0];
  return NextResponse.json({
    id: a.id, state: a.state, format: a.format, account: a.account.name, headline: a.headline, caption: a.caption,
    qc: { verdict: qcVerdict(qc), failed: (qc?.checks ?? []).filter((c) => !c.passed).map((c) => ({ id: c.id, label: c.label, severity: c.severity, detail: c.detail ?? null })) },
    media: publishableMedia(a).map((m) => ({ role: m.role, url: signedMediaUrl(m.storageKey, 3 * 86400), width: m.width, height: m.height, durationSec: m.durationSec })),
    publication: job ? { state: job.state, scheduledFor: job.scheduledFor, publicUrl: job.result?.publicUrl ?? null, verifiedAt: job.result?.verifiedAt ?? null, lastError: job.lastError } : null,
    reviewUrl: `/ads/${a.id}`,
  });
});
