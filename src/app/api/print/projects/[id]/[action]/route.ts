import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { AppError } from '@/lib/errors';
import { adFromPrint, approvePrint, exportPrint, generateHero, imagePlanPrint, mockupPrint, pickHero, previewPrint, undoPrint, upscalePrint } from '@/lib/print/service';
import { createProof } from '@/lib/print/proof';
import { quoteDraft, quoteFromPrint, quoteMessage } from '@/lib/print/quote';
import { prisma } from '@/lib/db';
import { can } from '@/lib/auth/rbac';
import { printUser } from '../../../_user';
type P = { params: Promise<{ id: string; action: string }> };
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
/** the public origin for links sent to customers (behind the proxy) */
const origin = (req: Request) => { const h = req.headers; const host = h.get('x-forwarded-host') ?? h.get('host') ?? ''; const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https'); return host ? `${proto}://${host}` : ''; };

export const GET = api<P>('ads:create', async (_req, { params, user }) => {
  const { id, action } = await params;
  if (action === 'image') return NextResponse.json({ ok: true, ...(await imagePlanPrint(id, printUser(user))) });
  if (action === 'quote') {
    const u = printUser(user);
    const leads = can(user.perms, 'ads:approve') ? await prisma.lead.findMany({ orderBy: { updatedAt: 'desc' }, take: 40, select: { id: true, name: true, contact: true, status: true } }) : [];
    return NextResponse.json({ ok: true, ...(await quoteDraft(id, u)), message: await quoteMessage(id, u, origin(_req)), leads, canQuote: can(user.perms, 'ads:approve') });
  }
  throw new AppError('NOT_FOUND', 'غير موجود', 404);
});
export const POST = api<P>('ads:create', async (req, { params, user }) => {
  const { id, action } = await params; const u = printUser(user);
  switch (action) {
    case 'preview': return NextResponse.json({ ok: true, ...(await previewPrint(id, u)) });
    case 'approve': return NextResponse.json({ ok: true, project: await approvePrint(id, u) });
    case 'export': return NextResponse.json({ ok: true, ...(await exportPrint(id, u)) });
    case 'mockup': return NextResponse.json({ ok: true, ...(await mockupPrint(id, u)) });
    case 'image': { const b = z.object({ quality: z.enum(['low', 'medium', 'high']).optional(), variants: z.number().int().min(1).max(3).optional() }).parse(await req.json().catch(() => ({}))); return NextResponse.json({ ok: true, project: await generateHero(id, u, b) }); }
    case 'pick': { const b = z.object({ index: z.number().int().min(0).max(2) }).parse(await req.json()); return NextResponse.json({ ok: true, project: await pickHero(id, b.index, u) }); }
    case 'quote': {
      if (!can(user.perms, 'ads:approve')) throw new AppError('FORBIDDEN', 'عروض الأسعار لمن يملك صلاحية المبيعات.', 403);
      const b = z.object({ leadId: z.string().max(60).optional(), newLead: z.object({ name: z.string().trim().min(2).max(80), contact: z.string().trim().max(60).optional() }).optional(), quantity: z.number().int().min(1).max(10_000_000), unitPrice: z.number().min(0).max(1_000_000), designFee: z.number().min(0).max(1_000_000).optional(), discount: z.number().min(0).max(1_000_000).optional(), notes: z.string().max(500).optional() }).parse(await req.json());
      const r = await quoteFromPrint(id, b, u);
      return NextResponse.json({ ok: true, ...r, message: await quoteMessage(id, u, origin(req)) });
    }
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
