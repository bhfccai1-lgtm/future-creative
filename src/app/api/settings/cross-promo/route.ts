import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { prisma } from '@/lib/db';
import { updateSettings } from '@/lib/settings';
import { audit } from '@/lib/audit';
import { planRecommended } from '@/lib/ops/recommended';

const Body = z.object({
  enabled: z.boolean(), maxPerTargetPerDay: z.number().int().min(1).max(6), delayMinutes: z.number().int().min(0).max(720),
  links: z.record(z.string(), z.array(z.string()).max(14)).optional(), // accountId → accounts that share its posts
  suggest: z.boolean().optional(), // fill links: every niche account → the general (all-products) accounts
});
export const PUT = api('automation:control', async (req, { user }) => {
  const b = Body.parse(await req.json());
  await updateSettings((x) => ({ ...x, publishing: { ...x.publishing, crossPromo: { enabled: b.enabled, maxPerTargetPerDay: b.maxPerTargetPerDay, delayMinutes: b.delayMinutes } } }), user.email);
  let links = b.links;
  if (b.suggest) {
    const plan = await planRecommended();
    const general = plan.filter((r) => !r.niche).map((r) => r.id);
    links = Object.fromEntries(plan.filter((r) => r.niche).map((r) => [r.id, general.slice(0, 3)]));
  }
  if (links) {
    const valid = new Set((await prisma.socialAccount.findMany({ select: { id: true } })).map((a) => a.id));
    for (const [id, to] of Object.entries(links)) if (valid.has(id)) await prisma.socialAccount.update({ where: { id }, data: { promoteToIds: to.filter((t) => t !== id && valid.has(t)) } });
  }
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'settings.cross_promo', details: { enabled: b.enabled, suggest: !!b.suggest, links: links ? Object.keys(links).length : 0 } });
  const accounts = await prisma.socialAccount.findMany({ select: { id: true, promoteToIds: true } });
  return NextResponse.json({ ok: true, links: Object.fromEntries(accounts.map((a) => [a.id, a.promoteToIds])) });
});
