import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clientIp } from '@/lib/auth/server';
import { AppError } from '@/lib/errors';
import { decideProof, publicProof } from '@/lib/print/proof';
type P = { params: Promise<{ token: string }> };
export const dynamic = 'force-dynamic';
const fail = (e: unknown) => { const err = e as AppError; return NextResponse.json({ error: err.code ?? 'ERROR', message: err.message }, { status: err.status ?? 500 }); };
/** PUBLIC (no login): the proof data behind a secret link */
export async function GET(_req: Request, { params }: P) {
  try { return NextResponse.json({ ok: true, ...(await publicProof((await params).token)) }); } catch (e) { return fail(e); }
}
/** PUBLIC: the client's decision (rate-limited, once per design version) */
export async function POST(req: Request, { params }: P) {
  try {
    const b = z.object({ decision: z.enum(['approve', 'changes']), name: z.string().max(80), note: z.string().max(1000).optional() }).parse(await req.json());
    return NextResponse.json({ ok: true, decision: await decideProof((await params).token, b, await clientIp()) });
  } catch (e) { if (e instanceof z.ZodError) return NextResponse.json({ error: 'INVALID', message: 'بيانات غير صالحة' }, { status: 422 }); return fail(e); }
}
