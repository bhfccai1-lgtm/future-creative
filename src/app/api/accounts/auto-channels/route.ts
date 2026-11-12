import { NextResponse } from 'next/server';
import type { SocialPlatform } from '@prisma/client';
import { api } from '@/lib/auth/server';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
import { linkedNetworks } from '@/lib/publishing/channels';

const AUTO: SocialPlatform[] = ['instagram', 'facebook', 'tiktok', 'threads', 'youtube', 'pinterest', 'linkedin', 'twitter'];

/** One click: every account publishes to all networks linked on its Metricool brand (Pinterest only once a board is set; Google Business stays on its own weekly setting). */
export const POST = api('accounts:manage', async (_req, { user }) => {
  const accounts = await prisma.socialAccount.findMany({ include: { connection: true } });
  const changed: { name: string; channels: string[] }[] = [];
  for (const a of accounts) {
    const nets = linkedNetworks(a.connection?.providerSnapshot).filter((n): n is SocialPlatform => AUTO.includes(n as SocialPlatform) && n !== a.platform && (n !== 'pinterest' || !!a.pinterestBoard));
    if (nets.join() === a.autoChannels.join()) continue;
    await prisma.socialAccount.update({ where: { id: a.id }, data: { autoChannels: nets } });
    changed.push({ name: a.name, channels: nets });
  }
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'accounts.auto_channels', details: { changed: changed.length } });
  return NextResponse.json({ ok: true, changed, message: changed.length ? `فُعّلت القنوات المرتبطة في ${changed.length} حساب` : 'لا تغيير — كل الحسابات على قنواتها المرتبطة' });
});
