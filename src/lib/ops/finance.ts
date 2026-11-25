import { prisma } from '../db';
import { quoteTotals, type Quote } from '../leads/scripts';

/**
 * «💰 العائد والتوقع» — financial + predictive intelligence from REAL rows only:
 *  - return: revenue of won leads (the owner's own numbers) against the AI spend, overall and per account
 *  - forecast: this month's expected revenue = already won + open pipeline × the shop's own win rate
 * Critical by design: every figure says where it comes from, per-account cost is an ESTIMATE (spend shared by the
 * account's number of designs — AI usage is not recorded per account), and the confidence drops with small samples.
 */
export const BHD_PER_USD = 0.376; // the Bahraini dinar is pegged to the US dollar

export type Confidence = 'low' | 'medium' | 'high';
export interface AccountReturn { id: string; name: string; revenueBhd: number; won: number; leads: number; designs: number; estCostBhd: number; roi: number | null }
export interface FinanceReport {
  days: number;
  spendUsd: number; spendBhd: number; revenueBhd: number; won: number; roi: number | null;
  accounts: AccountReturn[];
  /** accounts that cost money (≥ 5 designs) and brought no recorded revenue nor leads */
  noReturn: AccountReturn[];
  forecast: { wonThisMonthBhd: number; openPipelineBhd: number; openLeads: number; winRate: number | null; expectedBhd: number; confidence: Confidence; decided: number };
}

export interface FinanceInput {
  days: number;
  spendUsd: number;
  accounts: { id: string; name: string; designs: number }[];
  /** leads with their status in the window (for per-account revenue) */
  leads: { accountId: string | null; status: string; valueBhd: number | null; wonAt: Date | null; quote?: unknown }[];
  /** decided leads over the last 90 days (win rate) */
  decided90: { status: string }[];
  /** open leads now (pipeline) and won this month */
  open: { status: string; valueBhd: number | null; quote?: unknown }[];
  wonThisMonthBhd: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const valueOf = (l: { valueBhd: number | null; quote?: unknown }) => l.valueBhd ?? (l.quote ? quoteTotals(l.quote as Quote).total : 0);

/** pure: the report from already-loaded rows (exported for tests) */
export function financeFrom(i: FinanceInput): FinanceReport {
  const spendBhd = i.spendUsd * BHD_PER_USD;
  const wonRows = i.leads.filter((l) => l.status === 'WON');
  const revenueBhd = wonRows.reduce((a, l) => a + (l.valueBhd ?? 0), 0);
  const totalDesigns = i.accounts.reduce((a, x) => a + x.designs, 0) || 1;
  const accounts: AccountReturn[] = i.accounts.map((a) => {
    const mine = i.leads.filter((l) => l.accountId === a.id);
    const rev = mine.filter((l) => l.status === 'WON').reduce((s, l) => s + (l.valueBhd ?? 0), 0);
    const est = (spendBhd * a.designs) / totalDesigns;
    return { id: a.id, name: a.name, revenueBhd: r3(rev), won: mine.filter((l) => l.status === 'WON').length, leads: mine.length, designs: a.designs, estCostBhd: r3(est), roi: est > 0 ? Math.round((rev / est) * 10) / 10 : null };
  }).sort((x, y) => y.revenueBhd - x.revenueBhd || x.estCostBhd - y.estCostBhd);
  const noReturn = accounts.filter((a) => a.designs >= 5 && a.revenueBhd === 0 && a.leads === 0).sort((x, y) => y.estCostBhd - x.estCostBhd);
  // forecast: the shop's own win rate (90 days) applied to today's open pipeline
  const decided = i.decided90.length;
  const winRate = decided ? i.decided90.filter((l) => l.status === 'WON').length / decided : null;
  const openPipelineBhd = i.open.reduce((a, l) => a + valueOf(l), 0);
  const expectedBhd = i.wonThisMonthBhd + (winRate ?? 0) * openPipelineBhd;
  const confidence: Confidence = decided >= 30 ? 'high' : decided >= 10 ? 'medium' : 'low';
  return {
    days: i.days, spendUsd: Math.round(i.spendUsd * 100) / 100, spendBhd: r3(spendBhd), revenueBhd: r3(revenueBhd), won: wonRows.length,
    roi: spendBhd > 0 ? Math.round((revenueBhd / spendBhd) * 10) / 10 : null,
    accounts, noReturn,
    forecast: { wonThisMonthBhd: r3(i.wonThisMonthBhd), openPipelineBhd: r3(openPipelineBhd), openLeads: i.open.length, winRate: winRate === null ? null : Math.round(winRate * 100) / 100, expectedBhd: r3(expectedBhd), confidence, decided },
  };
}

export async function financeReport(now = new Date(), days = 30): Promise<FinanceReport> {
  const since = new Date(now.getTime() - days * 86400_000);
  const since90 = new Date(now.getTime() - 90 * 86400_000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [spend, accounts, designs, leads, decided90, open, wonMonth] = await Promise.all([
    prisma.aiUsage.aggregate({ _sum: { costUsd: true }, where: { createdAt: { gte: since } } }),
    prisma.socialAccount.findMany({ select: { id: true, name: true } }),
    prisma.advertisement.groupBy({ by: ['accountId'], _count: true, where: { createdAt: { gte: since }, dryRun: false } }),
    prisma.lead.findMany({ where: { OR: [{ createdAt: { gte: since } }, { wonAt: { gte: since } }] }, select: { accountId: true, status: true, valueBhd: true, wonAt: true } }),
    prisma.lead.findMany({ where: { status: { in: ['WON', 'LOST'] }, updatedAt: { gte: since90 } }, select: { status: true } }),
    prisma.lead.findMany({ where: { status: { in: ['NEW', 'CONTACTED', 'QUOTED'] } }, select: { status: true, valueBhd: true, quote: true }, take: 2000 }),
    prisma.lead.aggregate({ _sum: { valueBhd: true }, where: { status: 'WON', wonAt: { gte: monthStart } } }),
  ]);
  const count = new Map(designs.map((d) => [d.accountId, d._count]));
  return financeFrom({
    days, spendUsd: Number(spend._sum.costUsd ?? 0),
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, designs: count.get(a.id) ?? 0 })),
    leads, decided90, open, wonThisMonthBhd: Number(wonMonth._sum.valueBhd ?? 0),
  });
}
