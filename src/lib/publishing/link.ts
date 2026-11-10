import { prisma } from '../db';
import { getBusiness } from '../business';
import type { SocialPlatform } from '@prisma/client';
import type { PublishingAdapter } from './types';

export interface LinkResult { brand: string; brandId: string; account: string; action: 'linked' | 'refreshed' | 'created' | 'skipped'; reason?: string }

/**
 * Links every provider brand to an account in one step, using ONLY what the provider reports:
 *  - brand already linked → refresh its verified connection
 *  - otherwise → take an unconnected placeholder slot of that platform (or create an account), named after the brand
 * Auto-publishing is never switched on here.
 */
export async function linkAllBrands(adapter: PublishingAdapter): Promise<LinkResult[]> {
  const profiles = await adapter.listProfiles();
  const business = await getBusiness();
  const result: LinkResult[] = [];
  for (const p of profiles) {
    const nets = p.networks.map((n) => n.network);
    const platform = (nets.includes('instagram') ? 'instagram' : nets[0]) as SocialPlatform | undefined;
    if (!platform) { result.push({ brand: p.label, brandId: p.brandId, account: '—', action: 'skipped', reason: 'لا توجد شبكات مرتبطة بهذه العلامة في Metricool' }); continue; }
    const handle = p.networks.find((n) => n.network === platform)?.handle ?? null;
    const snapshot = { label: p.label, networks: p.networks };
    const existing = await prisma.socialConnection.findFirst({ where: { provider: 'metricool', providerBrandId: p.brandId }, include: { account: true } });
    if (existing) {
      await prisma.socialConnection.update({ where: { id: existing.id }, data: { status: 'CONNECTED', canPublish: true, lastVerifiedAt: new Date(), lastError: null, providerSnapshot: snapshot } });
      result.push({ brand: p.label, brandId: p.brandId, account: existing.account.name, action: 'refreshed' });
      continue;
    }
    // reuse an unconnected placeholder slot of the same platform before creating a new account
    const slot = await prisma.socialAccount.findFirst({ where: { platform, OR: [{ connection: null }, { connection: { status: { in: ['NOT_CONNECTED', 'DISCONNECTED', 'ERROR'] } } }] }, orderBy: { createdAt: 'asc' } });
    const name = p.label.replace(/^@/, '');
    const account = slot
      ? await prisma.socialAccount.update({ where: { id: slot.id }, data: { name, handle, externalId: p.brandId, timezone: p.timezone || slot.timezone } })
      : await prisma.socialAccount.create({ data: { businessId: business.id, name, platform, handle, externalId: p.brandId, timezone: p.timezone || 'Asia/Bahrain' } });
    await prisma.socialConnection.upsert({
      where: { accountId: account.id },
      create: { accountId: account.id, provider: 'metricool', providerBrandId: p.brandId, providerNetwork: platform, status: 'CONNECTED', canPublish: true, lastVerifiedAt: new Date(), providerSnapshot: snapshot },
      update: { provider: 'metricool', providerBrandId: p.brandId, providerNetwork: platform, status: 'CONNECTED', canPublish: true, lastVerifiedAt: new Date(), lastError: null, providerSnapshot: snapshot },
    });
    result.push({ brand: p.label, brandId: p.brandId, account: name, action: slot ? 'linked' : 'created' });
  }
  return result;
}
