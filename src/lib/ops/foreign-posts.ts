import { prisma } from '../db';
import { env } from '../env';
import { redis } from '../queue/connection';
import { getAdapter } from '../publishing/registry';
import { findClaims } from '../qc/checks';
import { inWindow } from '../time';
import { notify } from '../audit';
import { log } from './log';

/**
 * Watches every connected brand in Metricool for posts that were NOT made by this system (another tool, the
 * Metricool planner, a team member). They bypass QC, the posting window, the 30-minute gap and the claim rules,
 * so each new one is reported once with the concrete risks found. Read-only: nothing is changed or deleted.
 */
export interface ForeignPost { accountId: string; account: string; id: string; at: string | null; type: string; status: string; issues: string[]; text: string }

export async function scanForeignPosts(now = new Date(), opts: { notifyNew?: boolean } = { notifyNew: true }) {
  let adapter;
  try { adapter = await getAdapter('metricool'); } catch { return { scanned: 0, foreign: [] as ForeignPost[] }; }
  if (!adapter.listScheduled) return { scanned: 0, foreign: [] as ForeignPost[] };
  const base = env().PUBLIC_BASE_URL.replace(/\/$/, '');
  const accounts = await prisma.socialAccount.findMany({ where: { connection: { status: 'CONNECTED' } }, include: { connection: true } });
  const ours = new Set((await prisma.publicationResult.findMany({ where: { createdAt: { gte: new Date(now.getTime() - 3 * 86400_000) } }, select: { providerPostId: true } })).map((r) => r.providerPostId).filter(Boolean) as string[]);
  const foreign: ForeignPost[] = [];
  for (const a of accounts) {
    const brand = a.connection?.providerBrandId;
    if (!brand) continue;
    let posts;
    try { posts = await adapter.listScheduled(brand, new Date(now.getTime() - 12 * 3600_000), new Date(now.getTime() + 48 * 3600_000), a.timezone); }
    catch (e) { log.warn('foreign_posts.list_failed', { account: a.name, error: (e as Error).message }); continue; }
    for (const p of posts) {
      const isOurs = ours.has(p.id) || p.media.some((m) => m.startsWith(base));
      if (isOurs) continue;
      const issues: string[] = [];
      if (p.at && !inWindow(p.at, a.publishWindowStart, a.publishWindowEnd, a.timezone)) issues.push(`خارج نافذة النشر (${a.publishWindowStart}–${a.publishWindowEnd})`);
      const claims = findClaims(p.text);
      if (claims.length) issues.push(`عبارات ممنوعة: ${claims.join('، ')}`);
      if (/بسرعة|فوري|خلال ساعة|same day|fast|quick|വേഗത്തിൽ/i.test(p.text)) issues.push('وعد بسرعة التنفيذ/التوصيل');
      if (p.text.trim() === '' && p.type !== 'STORY') issues.push('بدون نص');
      foreign.push({ accountId: a.id, account: a.name, id: p.id, at: p.at?.toISOString() ?? null, type: p.type, status: p.status, issues, text: p.text.slice(0, 160) });
    }
  }
  if (opts.notifyNew) {
    const fresh: ForeignPost[] = [];
    for (const f of foreign) if (await redis().set(`foreign:${f.id}`, '1', 'EX', 14 * 86400, 'NX')) fresh.push(f);
    const byAcc = new Map<string, ForeignPost[]>();
    for (const f of fresh) byAcc.set(f.accountId, [...(byAcc.get(f.accountId) ?? []), f]);
    for (const [accountId, list] of byAcc) {
      const risky = list.filter((f) => f.issues.length);
      const fmt = (iso: string | null) => (iso ? new Intl.DateTimeFormat('ar-BH', { timeZone: 'Asia/Bahrain', weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—');
      await notify(risky.length ? 'WARNING' : 'INFO', 'FOREIGN_POSTS', `منشورات أُضيفت خارج النظام على ${list[0].account} (${list.length})`,
        `لم ينشئها النظام، فلا تمر بفحص الجودة ولا نافذة النشر ولا فاصل الـ30 دقيقة. ${list.map((f) => `• ${fmt(f.at)} ${f.type}${f.issues.length ? ` ⚠️ ${f.issues.join('؛ ')}` : ''}`).join(' ')} — راجعها في Metricool.`, accountId);
    }
  }
  return { scanned: accounts.length, foreign };
}
