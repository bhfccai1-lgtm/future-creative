import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { notify } from '../audit';
import { getSecret, getSettings } from '../settings';
import { getAiProvider } from '../ai';
import { assertBudget, estimateTextCost, recordUsage } from '../ai/cost';
import { accountPlans, postScore, type PlanPost } from '../growth/account-plan';
import { publishableMedia } from '../publishing/media';
import { SCRIPT_VERSION, type DriveMeta } from './google-archive';

/**
 * SMART GOOGLE DRIVE (archive script v3):
 *  - live performance: every night the «published» sheet gets each design's real numbers (views, reach, saves,
 *    shares, comments, retention, skip, performance score) — sortable and filterable in Google Sheets
 *  - «⭐ أفضل التصاميم»: the best performers of each account are copied into a portfolio folder (ready to share)
 *  - a monthly smart report as a Google Doc in «التقارير»: written by the AI from the real numbers (one small text
 *    call), or from the numbers alone without a key
 */
type Fetch = typeof fetch;
export async function callScript(event: string, data: unknown, fetchImpl: Fetch = fetch) {
  const url = await getSecret('GOOGLE_ARCHIVE_URL');
  if (!url) throw new Error('Google archive is not connected');
  const r = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event, data }), signal: AbortSignal.timeout(120_000) });
  const j = (await r.json().catch(() => null)) as ({ ok?: boolean; error?: string } & Record<string, unknown>) | null;
  if (!j?.ok) throw new Error(`script ${event}: ${j?.error ?? (j ? 'failed' : 'no JSON answer')} — update the script to version ${SCRIPT_VERSION}`);
  return j;
}

type M = { views?: number; reach?: number; saves?: number; shares?: number; comments?: number; likes?: number; retentionPct?: number; skipRatePct?: number };
async function measured(since: Date) {
  const jobs = await prisma.publicationJob.findMany({
    where: { primary: true, result: { verifiedAt: { gte: since }, metricsFetchedAt: { not: null } } },
    include: { result: true, account: { select: { name: true } }, advertisement: { include: { media: true } } },
  });
  return jobs.map((j) => {
    const m = (j.result?.metrics ?? {}) as M;
    const p: PlanPost = { adId: j.advertisementId, hook: '', headline: j.advertisement.headline, format: j.advertisement.format, publishedAt: (j.result?.verifiedAt ?? j.scheduledFor).toISOString(), product: '', category: '',
      views: m.views ?? 0, reach: m.reach ?? 0, likes: m.likes ?? 0, comments: m.comments ?? 0, saves: m.saves ?? 0, shares: m.shares ?? 0,
      retention: typeof m.retentionPct === 'number' ? Math.round(m.retentionPct) : null, skip: typeof m.skipRatePct === 'number' ? Math.round(m.skipRatePct) : null };
    return { p, score: Math.round(postScore(p) * 10) / 10, account: j.account.name, ad: j.advertisement };
  });
}

/** nightly: the real numbers of every measured design into the archive sheet */
export async function syncMetricsToDrive(opts: { now?: Date; fetchImpl?: Fetch } = {}) {
  const now = opts.now ?? new Date();
  const rows = await measured(new Date(now.getTime() - 60 * 86400_000));
  let updated = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200).map((r) => ({ adId: r.p.adId, views: r.p.views, reach: r.p.reach, saves: r.p.saves, shares: r.p.shares, comments: r.p.comments, retention: r.p.retention, skip: r.p.skip, score: r.score }));
    const j = await callScript('metrics.update', { at: now.toISOString().slice(0, 16).replace('T', ' '), rows: batch }, opts.fetchImpl);
    updated += Number(j.updated ?? 0);
  }
  return { sent: rows.length, updated };
}

/** the best 3 designs of each account (last 30 days, at least 20 views) are copied into «⭐ أفضل التصاميم» once */
export async function curateBest(opts: { now?: Date; perAccount?: number; minViews?: number; fetchImpl?: Fetch } = {}) {
  const now = opts.now ?? new Date();
  const rows = (await measured(new Date(now.getTime() - 30 * 86400_000))).filter((r) => r.p.views >= (opts.minViews ?? 20));
  const byAcc = new Map<string, typeof rows>();
  for (const r of rows) byAcc.set(r.account, [...(byAcc.get(r.account) ?? []), r]);
  let copied = 0, designs = 0;
  for (const [account, list] of byAcc) {
    for (const r of list.sort((a, b) => b.score - a.score).slice(0, opts.perAccount ?? 3)) {
      const files = publishableMedia(r.ad);
      const metas = files.map((f) => (f.meta as (DriveMeta & { bestAt?: string }) | null) ?? {});
      if (!files.length || metas.some((x) => x.bestAt) || !metas.every((x) => x.drive?.id)) continue; // already curated or not on Drive yet
      const j = await callScript('best.copy', { account, prefix: `${r.p.publishedAt.slice(0, 10)} · ${r.p.views} مشاهدة`, fileIds: metas.map((x) => x.drive!.id) }, opts.fetchImpl);
      copied += Number(j.copied ?? 0); designs++;
      for (const [k, f] of files.entries()) await prisma.mediaAsset.update({ where: { id: f.id }, data: { meta: { ...metas[k], bestAt: now.toISOString() } as Prisma.InputJsonValue } });
    }
  }
  return { designs, copied };
}

type Block = { type: 'h1' | 'h2' | 'p' | 'li'; text: string };
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

/** the numbers-only report (always correct; also the fallback when the AI is unavailable) */
export function reportFromNumbers(title: string, plans: Awaited<ReturnType<typeof accountPlans>>): Block[] {
  const sorted = [...plans].sort((a, b) => b.totals.views - a.totals.views);
  const tot = sorted.reduce((s, p) => ({ posts: s.posts + p.measured, views: s.views + p.totals.views, saves: s.saves + p.totals.saves, conv: s.conv + p.totals.comments + p.totals.shares }), { posts: 0, views: 0, saves: 0, conv: 0 });
  const blocks: Block[] = [{ type: 'h1', text: title }, { type: 'p', text: `${tot.posts} منشورًا مقاسًا · ${tot.views} مشاهدة · ${tot.saves} حفظ · ${tot.conv} تعليق ومشاركة.` }, { type: 'h2', text: 'ترتيب الحسابات' }];
  for (const p of sorted) blocks.push({ type: 'li', text: `${p.account.name}: ${p.totals.views} مشاهدة، ${p.totals.saves} حفظ${p.totals.skip !== null ? `، تخطٍّ ${p.totals.skip}٪` : ''}${p.issues[0] ? ` — ${p.issues[0].text}` : ''}` });
  blocks.push({ type: 'h2', text: 'أفضل المنشورات' });
  for (const p of sorted.filter((x) => x.top).slice(0, 5)) blocks.push({ type: 'li', text: `${p.account.name}: «${p.top!.hook || p.top!.headline}» — ${p.top!.views} مشاهدة (${p.top!.reason})` });
  blocks.push({ type: 'h2', text: 'خطة الشهر القادم' });
  for (const p of sorted.slice(0, 5)) if (p.ideas[0]) blocks.push({ type: 'li', text: `${p.account.name}: ${p.ideas[0].title} — ${p.ideas[0].idea}` });
  return blocks;
}

/** the monthly smart report → a Google Doc in «التقارير» (AI-written from the numbers when a key is set) */
export async function monthlyReport(opts: { now?: Date; fetchImpl?: Fetch } = {}) {
  const now = opts.now ?? new Date();
  const d = new Date(now.getTime() - 15 * 86400_000); // the month that just ended (run on day 1)
  const title = `تقرير ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} — إبداع المستقبل`;
  const plans = await accountPlans({ now, days: 30 });
  let blocks = reportFromNumbers(title, plans), source: 'ai' | 'numbers' = 'numbers';
  const s = await getSettings();
  const provider = await getAiProvider(s).catch(() => null);
  if (provider && !provider.isDryRun && provider.generateJson) {
    try {
      await assertBudget(s, estimateTextCost(s, 6000, 1500));
      const data = plans.map((p) => ({ account: p.account.name, posts: p.measured, totals: p.totals, top: p.top && { hook: p.top.hook, views: p.top.views, reason: p.top.reason }, issues: p.issues.map((i) => i.text), ideas: p.ideas.slice(0, 2).map((i) => i.title) }));
      const r = await provider.generateJson([
        'You are the marketing director of a print shop in Bahrain writing the monthly report for the owner, in clear Arabic (light Gulf tone).',
        'Use ONLY the numbers given; never invent figures. Separate what the numbers show from your interpretation (say «تفسير محتمل»).',
        'Structure: h1 title, a 2-sentence summary, h2 «أهم النتائج» (3-5 li), h2 «ما نجح ولماذا», h2 «المشاكل وحلولها» (li), h2 «خطة الشهر القادم» (5 li, concrete per account).',
        'Return JSON {"blocks":[{"type":"h1|h2|p|li","text":"..."}]} — at most 40 blocks.',
      ].join('\n'), JSON.stringify({ title, accounts: data }), s.ai.textModel);
      await recordUsage({ provider: provider.name, model: r.model, kind: 'text', inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, costUsd: estimateTextCost(s, r.usage.inputTokens, r.usage.outputTokens) });
      const ai = ((r.json as { blocks?: Block[] })?.blocks ?? []).filter((b) => ['h1', 'h2', 'p', 'li'].includes(b?.type) && typeof b.text === 'string' && b.text.trim()).slice(0, 40).map((b) => ({ type: b.type, text: b.text.slice(0, 1200) }));
      if (ai.length >= 5) { blocks = [...ai, { type: 'h2', text: 'الأرقام كما سجّلها Metricool' }, ...reportFromNumbers(title, plans).slice(1)]; source = 'ai'; }
    } catch { /* the numbers-only report is used */ }
  }
  const j = await callScript('report.doc', { title, blocks }, opts.fetchImpl);
  await notify('INFO', 'DRIVE_MONTHLY_REPORT', `📄 ${title}`, `التقرير الشهري جاهز في Google Drive ← التقارير: ${String(j.url ?? '')}`).catch(() => undefined);
  return { title, url: String(j.url ?? ''), source, blocks: blocks.length };
}
