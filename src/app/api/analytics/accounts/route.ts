import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { getAdapter } from '@/lib/publishing/registry';
import { collectAccountInsights, saveInsights } from '@/lib/analytics/account-insights';
import { audit } from '@/lib/audit';
import { rateLimit } from '@/lib/security/rate-limit';
import { AppError } from '@/lib/errors';

/** Refresh the real per-account analytics from Metricool now (read-only; also refreshed by the nightly analytics job). */
export const POST = api('dashboard:view', async (_req, { user }) => {
  const rl = await rateLimit(`acct-insights:${user.sub}`, 6, 3600);
  if (!rl.ok) throw new AppError('RATE_LIMITED', 'حدّثت التحليلات كثيرًا خلال الساعة — حاول بعد قليل.', 429);
  const snap = await collectAccountInsights(await getAdapter('metricool') as never);
  await saveInsights(snap);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'analytics.accounts.refresh', details: { accounts: snap.accounts.length, failed: snap.accounts.filter((a) => a.error).length } });
  return NextResponse.json({ ok: true, at: snap.at, accounts: snap.accounts.length, failed: snap.accounts.filter((a) => a.error).length });
});
