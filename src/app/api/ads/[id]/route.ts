import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { deleteAdvertisement } from '@/lib/publishing/jobs';

/** Delete a design (never one that is published, scheduled or on its way) — audited. */
export const DELETE = api<{ params: Promise<{ id: string }> }>('ads:approve', async (_req, { params, user }) => {
  const r = await deleteAdvertisement((await params).id, { id: user.sub, email: user.email });
  return NextResponse.json({ ok: true, message: `حُذف التصميم (${r.files} ملف) ✓` });
});
