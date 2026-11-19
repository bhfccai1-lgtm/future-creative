import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { AppError } from '@/lib/errors';
import { adFromPrint, approvePrint, exportPrint, generateHero, imagePlanPrint, mockupPrint, previewPrint, undoPrint, upscalePrint } from '@/lib/print/service';
import { createProof } from '@/lib/print/proof';
import { printUser } from '../../../_user';
type P = { params: Promise<{ id: string; action: string }> };
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export const GET = api<P>('ads:create', async (_req, { params, user }) => {
  const { id, action } = await params;
  if (action === 'image') return NextResponse.json({ ok: true, ...(await imagePlanPrint(id, printUser(user))) });
  throw new AppError('NOT_FOUND', 'غير موجود', 404);
});
export const POST = api<P>('ads:create', async (req, { params, user }) => {
  const { id, action } = await params; const u = printUser(user);
  switch (action) {
    case 'preview': return NextResponse.json({ ok: true, ...(await previewPrint(id, u)) });
    case 'approve': return NextResponse.json({ ok: true, project: await approvePrint(id, u) });
    case 'export': return NextResponse.json({ ok: true, ...(await exportPrint(id, u)) });
    case 'mockup': return NextResponse.json({ ok: true, ...(await mockupPrint(id, u)) });
    case 'image': return NextResponse.json({ ok: true, project: await generateHero(id, u) });
    case 'proof': return NextResponse.json({ ok: true, ...(await createProof(id, u)) });
    case 'upscale': return NextResponse.json({ ok: true, ...(await upscalePrint(id, u)) });
    case 'undo': return NextResponse.json({ ok: true, project: await undoPrint(id, u) });
    case 'ad': {
      const b = z.object({ accountIds: z.array(z.string().max(60)).min(1).max(20), format: z.enum(['IMAGE_FEED', 'IMAGE_STORY', 'IMAGE_SQUARE']).default('IMAGE_FEED'), clientConsent: z.boolean().default(false), note: z.string().max(300).optional() }).parse(await req.json());
      return NextResponse.json({ ok: true, ...(await adFromPrint(id, b, u)) });
    }
    default: throw new AppError('NOT_FOUND', 'إجراء غير معروف', 404);
  }
});
