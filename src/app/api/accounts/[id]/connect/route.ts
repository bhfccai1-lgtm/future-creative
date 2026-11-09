import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { api } from '@/lib/auth/server';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { getAdapter } from '@/lib/publishing/registry';

const Body = z.object({ provider: z.literal('metricool'), providerBrandId: z.string().min(1).max(50) });

/**
 * Links an account to a Metricool brand. The link is only marked CONNECTED if the provider itself
 * lists that brand AND reports the account's social network as connected on it.
 */
export const POST = api<{ params: Promise<{ id: string }> }>('accounts:manage', async (req, { params, user }) => {
  const { id } = await params;
  const { provider, providerBrandId } = Body.parse(await req.json());
  const acc = await prisma.socialAccount.findUniqueOrThrow({ where: { id } });
  const adapter = await getAdapter(provider);
  let profiles;
  try { profiles = await adapter.listProfiles(); }
  catch (e) {
    await prisma.socialConnection.upsert({ where: { accountId: id }, create: { accountId: id, provider, providerBrandId, status: 'ERROR', lastError: (e as Error).message }, update: { status: 'ERROR', lastError: (e as Error).message } });
    throw new AppError('PROVIDER_ERROR', `تعذر التحقق من المزود: ${(e as Error).message}`, 502);
  }
  const brand = profiles.find((p) => p.brandId === providerBrandId);
  const net = brand?.networks.find((n) => n.network === acc.platform);
  const status = !brand ? 'ERROR' : !net ? 'INSUFFICIENT_PERMISSIONS' : 'CONNECTED';
  const lastError = !brand ? 'العلامة التجارية غير موجودة في حساب Metricool' : !net ? `الشبكة ${acc.platform} غير مرتبطة بهذه العلامة في Metricool` : null;
  const conn = await prisma.socialConnection.upsert({
    where: { accountId: id },
    create: { accountId: id, provider, providerBrandId, providerNetwork: acc.platform, status, canPublish: status === 'CONNECTED', lastVerifiedAt: new Date(), lastError, providerSnapshot: brand ? { label: brand.label, networks: brand.networks } : undefined },
    update: { provider, providerBrandId, providerNetwork: acc.platform, status, canPublish: status === 'CONNECTED', lastVerifiedAt: new Date(), lastError, providerSnapshot: brand ? { label: brand.label, networks: brand.networks } : undefined },
  });
  if (status === 'CONNECTED') await prisma.socialAccount.update({ where: { id }, data: { externalId: providerBrandId, handle: acc.handle ?? net?.handle ?? null } });
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'account.connect', targetType: 'social_account', targetId: id, details: { provider, providerBrandId, status } });
  return NextResponse.json({ status: conn.status, lastError: conn.lastError }, { status: status === 'CONNECTED' ? 200 : 422 });
});
