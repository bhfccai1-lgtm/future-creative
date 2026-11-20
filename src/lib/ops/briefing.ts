import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { notify } from '../audit';
import { getSettings } from '../settings';
import { getAiProvider } from '../ai';
import { assertBudget, estimateTextCost, monthToDateSpend, recordUsage } from '../ai/cost';
import { metricFields, postScore, type PlanPost } from '../growth/account-plan';

/**
 * «☀️ موجز الصباح الذكي» — one morning page that joins every module and says what matters today:
 * approvals waiting, the hottest customers, sales vs target, yesterday's best post, today's safe trends,
 * what the system's health advisor flags, Google visibility gaps and the AI budget — then ranks the
 * THREE actions worth doing first. Deterministic (no cost); the owner may let the AI phrase it (one call/day).
 * Shown on the dashboard, sent as a notification, readable by the assistant. Nothing is done automatically.
 */
export interface BriefAction { id: string; weight: number; text: string; link: string }
export interface Brief {
  at: string;
  numbers: { pendingApprovals: number; readyToPublish: number; hotLeads: number; overdueFollowUps: number; revenue: number; target: number; trendIdeas: number; aiSpendUsd: number; aiBudgetUsd: number; thinPages: number };
  bestPost: { headline: string | null; account: string; views: number; score: number; adId: string } | null;
  topLeads: { name: string; need: string; score: number }[];
  advisor: { title: string; severity: string } | null;
  actions: BriefAction[];
  text: string;
  source: 'rules' | 'ai';
}

const KEY = 'brief:latest';
const bhd = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 3 })} د.ب`;

/** pure: the three actions worth doing first (exported for tests) */
export function rankActions(n: Brief['numbers'], o: { topLead?: { name: string; score: number } | null; advisor?: { title: string; severity: string } | null; paceBehind?: boolean } = {}): BriefAction[] {
  const a: BriefAction[] = [];
  if (n.hotLeads && o.topLead) a.push({ id: 'leads', weight: 90 + Math.min(10, n.hotLeads), text: `كلّم ${o.topLead.name} أولًا (درجة ${o.topLead.score}) — ${n.hotLeads} عميل ساخن ينتظر`, link: '/leads' });
  if (n.overdueFollowUps) a.push({ id: 'follow', weight: 70 + Math.min(20, n.overdueFollowUps * 3), text: `${n.overdueFollowUps} متابعة متأخرة — رسالة واتساب جاهزة لكل عميل`, link: '/leads' });
  if (o.advisor && ['critical', 'high'].includes(o.advisor.severity)) a.push({ id: 'health', weight: o.advisor.severity === 'critical' ? 95 : 75, text: `صحة النظام: ${o.advisor.title}`, link: '/diagnostics' });
  if (n.readyToPublish) a.push({ id: 'publish', weight: 60 + Math.min(25, n.readyToPublish * 2), text: `${n.readyToPublish} تصميم جاهز اجتاز الفحص — راجعه وانشره`, link: '/approvals' });
  else if (n.pendingApprovals) a.push({ id: 'review', weight: 45 + Math.min(20, n.pendingApprovals), text: `${n.pendingApprovals} تصميم بانتظار المراجعة`, link: '/approvals' });
  if (n.trendIdeas) a.push({ id: 'trends', weight: 55, text: `${n.trendIdeas} فكرة من ترند اليوم — اعتمدها قبل أن يبرد الترند`, link: '/trends' });
  if (o.paceBehind && n.target > 0) a.push({ id: 'sales', weight: 50, text: `المبيعات أقل من معدل الشهر (${bhd(n.revenue)} من ${bhd(n.target)}) — راسل العملاء السابقين`, link: '/leads' });
  if (n.aiBudgetUsd > 0 && n.aiSpendUsd >= n.aiBudgetUsd * 0.85) a.push({ id: 'budget', weight: 65, text: `ميزانية الذكاء الاصطناعي ${Math.round((n.aiSpendUsd / n.aiBudgetUsd) * 100)}٪ مستهلكة`, link: '/settings/ai' });
  if (n.thinPages >= 5) a.push({ id: 'seo', weight: 30, text: `${n.thinPages} صفحة منتج بلا وصف كافٍ — أكمل وصف ٣ منها لتظهر في Google`, link: '/products' });
  return a.sort((x, y) => y.weight - x.weight).slice(0, 3);
}

/** pure: the plain Arabic brief (also the fallback when the AI is not used) */
export function briefText(b: Omit<Brief, 'text' | 'source'>): string {
  const n = b.numbers;
  const lines = ['☀️ صباح الخير — موجز اليوم:'];
  lines.push(`• الموافقات: ${n.pendingApprovals} بانتظارك${n.readyToPublish ? `، منها ${n.readyToPublish} جاهز للنشر` : ''}.`);
  lines.push(`• العملاء: ${n.hotLeads} ساخن${n.overdueFollowUps ? ` · ${n.overdueFollowUps} متابعة متأخرة` : ''}${n.target ? ` · المبيعات ${bhd(n.revenue)} من ${bhd(n.target)}` : n.revenue ? ` · مبيعات الشهر ${bhd(n.revenue)}` : ''}.`);
  if (b.bestPost) lines.push(`• أفضل منشور مؤخرًا: «${b.bestPost.headline ?? '—'}» في ${b.bestPost.account} — ${b.bestPost.views} مشاهدة.`);
  if (n.trendIdeas) lines.push(`• الترند: ${n.trendIdeas} فكرة جاهزة.`);
  if (b.actions.length) { lines.push('', 'أهم ٣ خطوات اليوم:'); b.actions.forEach((x, i) => lines.push(`${i + 1}. ${x.text}`)); }
  return lines.join('\n');
}

export async function buildBrief(now = new Date()): Promise<Brief> {
  const s = await getSettings();
  const since = new Date(now.getTime() - 3 * 86400_000);
  const [{ todayPriorities }, { salesOverview }, { runAdvisor }, { seoHealth }] = await Promise.all([
    import('../leads/intel'), import('../leads/service'), import('./advisor'), import('../seo/catalog'),
  ]);
  const [pendingApprovals, readyToPublish, overdueFollowUps, trendIdeas, spend, priorities, sales, advisor, seo, recent] = await Promise.all([
    prisma.approvalRequest.count({ where: { status: 'PENDING' } }),
    prisma.approvalRequest.count({ where: { status: 'PENDING', advertisement: { qcPassed: true, dryRun: false, state: 'QUALITY_REVIEW' } } }),
    prisma.lead.count({ where: { status: { in: ['NEW', 'CONTACTED', 'QUOTED'] }, nextFollowUpAt: { lte: now } } }),
    prisma.idea.count({ where: { source: 'trend', status: 'NEW' } }),
    monthToDateSpend(now),
    todayPriorities(now, 12).catch(() => []),
    salesOverview(now).catch(() => null),
    runAdvisor(now).catch(() => null),
    seoHealth().catch(() => null),
    prisma.publicationJob.findMany({ where: { primary: true, result: { verifiedAt: { gte: since }, metricsFetchedAt: { not: null } } }, include: { result: true, account: { select: { name: true } }, advertisement: { select: { headline: true, format: true } } }, take: 300 }),
  ]);
  const hot = priorities.filter((p) => p.tier === 'hot');
  const best = recent.map((j) => {
    const p: PlanPost = { adId: j.advertisementId, hook: '', headline: j.advertisement.headline, format: j.advertisement.format, publishedAt: '', product: '', category: '', ...metricFields(j.result?.metrics) };
    return { headline: j.advertisement.headline, account: j.account.name, views: p.views, score: Math.round(postScore(p) * 10) / 10, adId: j.advertisementId };
  }).sort((a, b) => b.score - a.score)[0] ?? null;
  const top = advisor?.advice.find((x) => ['critical', 'high'].includes(x.severity)) ?? null;
  const numbers: Brief['numbers'] = {
    pendingApprovals, readyToPublish, hotLeads: hot.length, overdueFollowUps, revenue: sales?.month.revenue ?? 0, target: sales?.month.target ?? 0,
    trendIdeas, aiSpendUsd: Math.round(spend * 100) / 100, aiBudgetUsd: s.ai.monthlyBudgetUsd, thinPages: seo ? seo.total - seo.withDescription : 0,
  };
  const paceBehind = !!sales && sales.month.target > 0 && sales.month.revenue < sales.month.expectedByNow;
  const base = {
    at: now.toISOString(), numbers, bestPost: best && best.views > 0 ? best : null,
    topLeads: hot.slice(0, 3).map((p) => ({ name: p.name, need: p.need.slice(0, 80), score: p.score })),
    advisor: top ? { title: top.title, severity: top.severity } : null,
    actions: rankActions(numbers, { topLead: hot[0] ?? null, advisor: top ? { title: top.title, severity: top.severity } : null, paceBehind }),
  };
  return { ...base, text: briefText(base), source: 'rules' };
}

/** the owner may let the AI phrase the brief warmly in Gulf Arabic (facts only, one small call a day) */
async function phrase(b: Brief): Promise<Brief> {
  const s = await getSettings();
  if (!s.briefing.aiWrite) return b;
  const provider = await getAiProvider(s).catch(() => null);
  if (!provider || provider.isDryRun || !provider.generateJson) return b;
  try {
    await assertBudget(s, estimateTextCost(s, 900, 350));
    const r = await provider.generateJson([
      'Rewrite this morning brief for a print-shop owner in Bahrain as a short, warm message in Gulf Arabic (max 9 lines).',
      'Use ONLY the facts given — never add numbers, names or promises. Keep the numbered «أهم ٣ خطوات اليوم» list in the same order.',
      'Return JSON {"text":"..."}.',
    ].join('\n'), JSON.stringify({ brief: b.text }), s.ai.textModel);
    await recordUsage({ provider: provider.name, model: r.model, kind: 'text', inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, costUsd: estimateTextCost(s, r.usage.inputTokens, r.usage.outputTokens) });
    const text = String((r.json as { text?: unknown })?.text ?? '').trim();
    return text.length > 40 ? { ...b, text: text.slice(0, 1500), source: 'ai' } : b;
  } catch { return b; }
}

/** the morning run (worker 07:35): build, keep for the dashboard, notify; WhatsApp to the owner when enabled */
export async function runMorningBrief(now = new Date(), send?: (to: string, text: string) => Promise<unknown>) {
  const s = await getSettings();
  if (!s.briefing.enabled) return { skipped: true as const };
  const b = await phrase(await buildBrief(now));
  await prisma.systemSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: b as unknown as Prisma.InputJsonValue, updatedBy: 'brief' }, update: { value: b as unknown as Prisma.InputJsonValue, updatedBy: 'brief' } });
  await notify('INFO', 'MORNING_BRIEF', '☀️ موجز الصباح', b.actions.length ? b.actions.map((x, i) => `${i + 1}. ${x.text}`).join('\n') : 'لا شيء عاجل اليوم 👌').catch(() => undefined);
  let whatsapp = 0;
  if (s.briefing.whatsapp && s.whatsapp.cloud.enabled && s.whatsapp.cloud.ownerNumbers.length) {
    const { sendWhatsappText } = await import('../integrations/whatsapp-cloud');
    const { normalizeWaPhone } = await import('../integrations/whatsapp-numbers');
    for (const n of s.whatsapp.cloud.ownerNumbers) {
      const to = normalizeWaPhone(n) ?? n;
      const r = (await (send ? send(to, b.text) : sendWhatsappText(to, b.text)).catch(() => null)) as { ok?: boolean } | null;
      if (r?.ok) whatsapp++;
    }
  }
  return { actions: b.actions.length, source: b.source, whatsapp };
}

export async function latestBrief(): Promise<Brief | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: KEY } }).catch(() => null);
  return (row?.value as Brief | undefined) ?? null;
}
