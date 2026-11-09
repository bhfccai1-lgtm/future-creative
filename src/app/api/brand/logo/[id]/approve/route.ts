import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { approveLogo } from '@/lib/brand/logo';
import { audit } from '@/lib/audit';
export const POST = api<{ params: Promise<{ id: string }> }>('brand:manage', async (_req, { params, user }) => {
  const { id } = await params;
  await approveLogo(id, user.email);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'brand.logo.approve', targetType: 'brand_asset', targetId: id });
  return NextResponse.json({ ok: true });
});
