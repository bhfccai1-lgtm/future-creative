import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { runFix } from '@/lib/ops/fixes';
export const dynamic = 'force-dynamic';

const Body = z.object({ ids: z.array(z.string().max(40)).min(1).max(10) });

/** Runs diagnostics fixes (admins only; each one audited and re-checked). Several ids = «إصلاح كل ما يمكن آليًا». */
export const POST = api('settings:integrations', async (req, { user }) => {
  const { ids } = Body.parse(await req.json());
  const results: { id: string; ok: boolean; message: string }[] = [];
  for (const id of [...new Set(ids)]) results.push({ id, ...(await runFix(id, user)) }); // one after another: they share the database and queues
  return NextResponse.json({ results });
});
