import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { getAdapter } from '@/lib/publishing/registry';
import { updateSettings } from '@/lib/settings';
import { AppError } from '@/lib/errors';
export const POST = api('settings:integrations', async (_req, { user }) => {
  let r: { ok: boolean; message: string };
  try { r = await (await getAdapter('metricool')).verify(); } catch (e) { r = { ok: false, message: e instanceof AppError ? e.message : (e as Error).message }; }
  await updateSettings((x) => ({ ...x, metricool: { ...x.metricool, lastCheckAt: new Date().toISOString(), lastCheckOk: r.ok, lastCheckMessage: r.message } }), user.email);
  return NextResponse.json(r);
});
