import { prisma } from '../db';
import { notify } from '../audit';
import type { PublishingAdapter } from './types';

/**
 * Re-verifies every Metricool-linked account against the provider's CURRENT brand list.
 * If a brand or its network disappeared (e.g. Instagram disconnected inside Metricool), the account
 * stops publishing (canPublish=false) and an alert is raised; when it comes back it is restored.
 */
export async function verifyConnections(adapter: PublishingAdapter) {
  const profiles = await adapter.listProfiles();
  const byId = new Map(profiles.map((p) => [p.brandId, p]));
  const conns = await prisma.socialConnection.findMany({ where: { provider: 'metricool', providerBrandId: { not: null }, status: { not: 'DISCONNECTED' } }, include: { account: true } });
  const out = { ok: 0, lost: 0, restored: 0 };
  for (const c of conns) {
    const brand = byId.get(c.providerBrandId!);
    const net = brand?.networks.find((n) => n.network === c.account.platform);
    if (brand && net) {
      const wasBroken = c.status !== 'CONNECTED' || !c.canPublish;
      await prisma.socialConnection.update({ where: { id: c.id }, data: { status: 'CONNECTED', canPublish: true, lastVerifiedAt: new Date(), lastError: null, providerSnapshot: { label: brand.label, networks: brand.networks } } });
      if (wasBroken) { out.restored++; await notify('INFO', 'CONNECTION_RESTORED', 'عاد ربط الحساب', `${c.account.name}: الحساب متاح مجددًا في Metricool.`, c.accountId); }
      else out.ok++;
    } else {
      const reason = !brand ? 'العلامة لم تعد موجودة في Metricool' : `شبكة ${c.account.platform} لم تعد مرتبطة بالعلامة في Metricool (أعد ربطها داخل Metricool)`;
      if (c.status === 'CONNECTED') await notify('ERROR', 'CONNECTION_LOST', 'انقطع ربط حساب', `${c.account.name}: ${reason}`, c.accountId);
      await prisma.socialConnection.update({ where: { id: c.id }, data: { status: brand ? 'INSUFFICIENT_PERMISSIONS' : 'ERROR', canPublish: false, lastVerifiedAt: new Date(), lastError: reason } });
      out.lost++;
    }
  }
  return out;
}
