import { prisma } from '../db';
import { notify } from '../audit';
import { STAGES, STAGE_AR, type Production, type Stage } from './production';

/**
 * ORDERS BOARD: where every print job stands and what needs a person today —
 * proofs waiting for the client, changes requested, approved designs without files, jobs stuck in a stage,
 * orders ready but not collected. Feeds the studio dashboard and a daily 09:15 reminder.
 */
const DAY = 86400_000;
export interface BoardItem { id: string; title: string; productId: string; since: string; days: number; note?: string }
export interface Board {
  stages: Record<Stage, number>;
  awaitingClient: BoardItem[]; changesRequested: BoardItem[]; needFiles: BoardItem[]; stuck: BoardItem[]; readyNotCollected: BoardItem[];
}
const daysSince = (d: Date | string, now: Date) => Math.floor((now.getTime() - new Date(d).getTime()) / DAY);

export async function printBoard(owner: string | null, now = new Date()): Promise<Board> {
  const rows = await prisma.printProject.findMany({ where: owner ? { createdBy: owner } : {}, orderBy: { updatedAt: 'desc' }, take: 500, select: { id: true, title: true, productId: true, status: true, updatedAt: true, exports: true, production: true, proofToken: true, proofExpiresAt: true, clientDecision: true, approvedAt: true } });
  const stages = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
  const b: Board = { stages, awaitingClient: [], changesRequested: [], needFiles: [], stuck: [], readyNotCollected: [] };
  for (const r of rows) {
    const item = (since: Date | string, note?: string): BoardItem => ({ id: r.id, title: r.title, productId: r.productId, since: new Date(since).toISOString(), days: daysSince(since, now), ...(note ? { note } : {}) });
    const dec = r.clientDecision as { status: string; at: string; name: string; note?: string } | null;
    const prod = r.production as Production | null;
    if (prod) {
      stages[prod.stage]++;
      const last = prod.history[prod.history.length - 1];
      if (prod.stage === 'ready' && last && daysSince(last.at, now) >= 2) b.readyNotCollected.push(item(last.at));
      else if (prod.stage !== 'delivered' && prod.stage !== 'ready' && last && daysSince(last.at, now) >= 2) b.stuck.push(item(last.at, STAGE_AR[prod.stage]));
      continue;
    }
    if (dec?.status === 'changes') { b.changesRequested.push(item(dec.at, `${dec.name}: ${(dec.note ?? '').slice(0, 80)}`)); continue; }
    if (r.proofToken && !dec && r.proofExpiresAt && r.proofExpiresAt > now && r.status !== 'approved' && r.status !== 'exported') { b.awaitingClient.push(item(r.updatedAt)); continue; }
    if (r.status === 'approved' && !r.exports) b.needFiles.push(item(r.approvedAt ?? r.updatedAt));
  }
  for (const k of ['awaitingClient', 'changesRequested', 'needFiles', 'stuck', 'readyNotCollected'] as const) b[k].sort((x, y) => y.days - x.days);
  return b;
}

/** daily reminder (worker 09:15): only when something needs a person */
export async function printFollowUps(now = new Date()) {
  const b = await printBoard(null, now);
  const lines: string[] = [];
  const late = b.awaitingClient.filter((x) => x.days >= 2);
  if (late.length) lines.push(`⏳ ${late.length} بروفة بلا رد من العميل منذ يومين أو أكثر: ${late.slice(0, 5).map((x) => x.title).join('، ')}`);
  if (b.changesRequested.length) lines.push(`✏️ ${b.changesRequested.length} طلب تعديل من العملاء: ${b.changesRequested.slice(0, 5).map((x) => x.title).join('، ')}`);
  if (b.needFiles.length) lines.push(`📁 ${b.needFiles.length} تصميم معتمد بلا ملفات إنتاج: ${b.needFiles.slice(0, 5).map((x) => x.title).join('، ')}`);
  if (b.stuck.length) lines.push(`🛠 ${b.stuck.length} طلب متوقف في مرحلة منذ يومين: ${b.stuck.slice(0, 5).map((x) => `${x.title} (${x.note})`).join('، ')}`);
  if (b.readyNotCollected.length) lines.push(`📦 ${b.readyNotCollected.length} طلب جاهز ولم يُستلم: ${b.readyNotCollected.slice(0, 5).map((x) => x.title).join('، ')}`);
  if (!lines.length) return { items: 0 };
  await notify('WARNING', 'PRINT_FOLLOW_UP', 'متابعة طلبات الطباعة اليوم', `${lines.join('\n')}\n\nافتح «PRINT DESIGN STUDIO» ← لوحة المشاريع.`);
  return { items: lines.length };
}
