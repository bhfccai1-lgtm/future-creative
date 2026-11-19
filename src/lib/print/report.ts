import { prisma } from '../db';
import { getSettings } from '../settings';
import { productById, FAMILIES } from './catalog';
import type { Production } from './production';

/**
 * MONTHLY PRINT REPORT (Bahrain time): delivered orders and their quoted value per product, proof acceptance,
 * turnaround from approval to delivery, and progress towards the monthly sales target. Values come only from quotes
 * the shop typed (linked customer records); an order without a quote counts as an order with no value — never guessed.
 */
const TZ_OFFSET = 3 * 3600_000; // Asia/Bahrain, no DST
export function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1) - TZ_OFFSET), to = new Date(Date.UTC(y, m, 1) - TZ_OFFSET);
  return { from, to };
}
export const currentMonth = (now = new Date()) => new Date(now.getTime() + TZ_OFFSET).toISOString().slice(0, 7);

export async function printReport(month = currentMonth(), owner: string | null = null) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('month must be YYYY-MM');
  const { from, to } = monthRange(month);
  const rows = await prisma.printProject.findMany({ where: { ...(owner ? { createdBy: owner } : {}), updatedAt: { gte: from } }, select: { id: true, title: true, productId: true, leadId: true, approvedAt: true, production: true, clientDecision: true, proofHash: true, createdAt: true } });
  const leadIds = rows.map((r) => r.leadId).filter(Boolean) as string[];
  const leads = new Map((await prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, valueBhd: true } })).map((l) => [l.id, l.valueBhd ?? 0]));
  const inMonth = (d: string | Date | null | undefined) => !!d && new Date(d) >= from && new Date(d) < to;
  const byProduct = new Map<string, { productId: string; name: string; family: string; orders: number; revenue: number }>();
  let orders = 0, revenue = 0, withoutQuote = 0; const turn: number[] = [];
  let decisions = 0, approved = 0, changes = 0, created = 0;
  for (const r of rows) {
    if (inMonth(r.createdAt)) created++;
    const prod = r.production as Production | null;
    const delivered = prod?.history.filter((h) => h.stage === 'delivered').pop();
    if (delivered && inMonth(delivered.at)) {
      orders++;
      const v = r.leadId ? leads.get(r.leadId) ?? 0 : 0; if (!v) withoutQuote++; revenue += v;
      const p = productById(r.productId);
      const e = byProduct.get(r.productId) ?? { productId: r.productId, name: p?.ar ?? r.productId, family: p ? FAMILIES[p.family].ar : '', orders: 0, revenue: 0 };
      e.orders++; e.revenue += v; byProduct.set(r.productId, e);
      if (r.approvedAt) turn.push((new Date(delivered.at).getTime() - new Date(r.approvedAt).getTime()) / 86400_000);
    }
    const dec = r.clientDecision as { status: string; at: string } | null;
    if (dec && inMonth(dec.at)) { decisions++; if (dec.status === 'approved') approved++; else changes++; }
  }
  const s = await getSettings();
  const target = s.sales.monthlyTargetBhd;
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  return {
    month, created, orders, revenue: r3(revenue), withoutQuote,
    avgOrder: orders && revenue ? r3(revenue / (orders - withoutQuote || 1)) : 0,
    byProduct: [...byProduct.values()].map((x) => ({ ...x, revenue: r3(x.revenue) })).sort((a, b) => b.revenue - a.revenue || b.orders - a.orders),
    proofs: { decisions, approved, changes, approvalRate: decisions ? Math.round((approved / decisions) * 100) : null },
    turnaroundDays: turn.length ? Math.round((turn.reduce((a, b) => a + b, 0) / turn.length) * 10) / 10 : null,
    target: target > 0 ? { bhd: target, pct: Math.round((revenue / target) * 100) } : null,
  };
}
