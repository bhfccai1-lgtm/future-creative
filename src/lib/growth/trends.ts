import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { audit, notify } from '../audit';
import { getSettings } from '../settings';
import { getAiProvider } from '../ai';
import { assertBudget, estimateTextCost, recordUsage } from '../ai/cost';
import { productAllowed } from '../creative/selector';
import { IDEA_FORMATS } from '../ideas/bank';
import { log } from '../ops/log';

/**
 * «🔥 رادار الترند» — what people in Bahrain and Saudi Arabia are searching for TODAY, turned into ready ideas.
 *  1) READ: Google Trends' public daily feed per country (free, no key) — real searches with their volume.
 *  2) SAFETY: deaths, accidents, wars, politics, crime, religion disputes and tragedies are dropped BEFORE any AI
 *     sees them (a print shop never jumps on bad news); the AI double-checks every remaining trend.
 *  3) MATCH: one small AI text call links the safe trends to real products and accounts (only products the account
 *     is allowed to sell) → ideas with a hook, a format and why it fits. Nothing is invented without a real trend.
 *  4) EXECUTE: the ideas land in «بنك الأفكار» as NEW (source «trend») — the owner approves; nothing is published by
 *     itself. Trends die fast: unapproved trend ideas expire after 3 days.
 * Off by default (Settings → النمو). Without an AI key the radar still shows the safe trends, without ideas.
 */
export interface Trend { title: string; traffic: string; volume: number; news: string[]; geo: string }
export interface TrendIdea { id: string; accountId: string; account: string; trend: string; title: string; idea: string; hook: string | null; format: string | null; score: number | null; status: string }
export interface TrendRadar { at: string; geos: Record<string, Trend[]>; blocked: number; ideas: number; source: 'ai' | 'numbers' | 'none'; error?: string }

export const GEO_AR: Record<string, string> = { BH: 'البحرين', SA: 'السعودية', AE: 'الإمارات', KW: 'الكويت', QA: 'قطر', OM: 'عُمان' };
/** bad news a business must never ride (Arabic + English) */
export const SENSITIVE = /وفا[ةه]|توفي|مقتل|قتل|قتيل|ضحايا|حادث|حريق|انفجار|زلزال|فيضان|غرق|حرب|قصف|غارة|هجوم|إرهاب|ارهاب|اعتقال|سجن|محاكم|جريم|اغتصاب|تحرش|انتخاب|مظاهر|احتجاج|عزاء|جنازة|إعدام|اعدام|طائفي|مذهبي|إسرائيل|اسرائيل|غزة|فلسطين|لبنان|سوريا|إيران|ايران|\b(died|dies|death|dead|killed|kills?|murder|crash|accident|fire|explosion|earthquake|flood|war|attack|terror\w*|arrest\w*|prison|trial|election\w*|protest\w*|funeral|shooting|israel|gaza|iran)\b/i;

const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
const tag = (xml: string, name: string) => { const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)); return m ? decode(m[1]) : ''; };
/** «2000+» / «10K+» / «1M+» → a number for sorting */
export const volumeOf = (t: string) => { const m = t.replace(/,/g, '').match(/([\d.]+)\s*([KM]?)/i); return m ? Math.round(Number(m[1]) * (m[2].toUpperCase() === 'M' ? 1e6 : m[2].toUpperCase() === 'K' ? 1e3 : 1)) : 0; };

/** pure: Google Trends daily RSS → trends (exported for tests) */
export function parseTrendsRss(xml: string, geo: string): Trend[] {
  const out: Trend[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1], title = tag(it, 'title');
    if (!title) continue;
    const traffic = tag(it, 'ht:approx_traffic');
    const news = [...it.matchAll(/<ht:news_item_title>([\s\S]*?)<\/ht:news_item_title>/g)].map((n) => decode(n[1])).filter(Boolean).slice(0, 3);
    out.push({ title: title.slice(0, 120), traffic, volume: volumeOf(traffic), news: news.map((n) => n.slice(0, 160)), geo });
  }
  return out.sort((a, b) => b.volume - a.volume).slice(0, 25);
}
export const isSensitive = (t: Pick<Trend, 'title' | 'news'>) => SENSITIVE.test([t.title, ...t.news].join(' '));

type Fetch = typeof fetch;
export async function fetchTrends(geo: string, fetchImpl: Fetch = fetch) {
  const r = await fetchImpl(`https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; trend-radar)' }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`Google Trends ${geo}: HTTP ${r.status}`);
  return parseTrendsRss(await r.text(), geo);
}

export async function lastRadar(): Promise<TrendRadar | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: 'trends:last' } }).catch(() => null);
  return (row?.value as TrendRadar | undefined) ?? null;
}
export async function trendIdeas(): Promise<TrendIdea[]> {
  const rows = await prisma.idea.findMany({ where: { source: 'trend', createdAt: { gte: new Date(Date.now() - 7 * 86400_000) } }, include: { account: { select: { name: true } } }, orderBy: [{ createdAt: 'desc' }, { score: 'desc' }], take: 40 });
  return rows.map((r) => ({ id: r.id, accountId: r.accountId, account: r.account.name, trend: r.occasion ?? '', title: r.title, idea: r.idea, hook: r.hook, format: r.format, score: r.score, status: r.status }));
}

/** the daily run (worker 06:20, or «حدّث الآن») */
export async function runTrendRadar(opts: { now?: Date; fetchImpl?: Fetch; force?: boolean } = {}): Promise<TrendRadar | { skipped: true }> {
  const s = await getSettings();
  if (!s.trends.enabled && !opts.force) return { skipped: true };
  const now = opts.now ?? new Date();
  // expire: a trend is old news after 3 days
  await prisma.idea.updateMany({ where: { source: 'trend', status: 'NEW', createdAt: { lt: new Date(now.getTime() - 3 * 86400_000) } }, data: { status: 'REJECTED' } });

  const geos: Record<string, Trend[]> = {};
  let blocked = 0; const errors: string[] = [];
  for (const g of s.trends.geos) {
    try {
      const all = await fetchTrends(g, opts.fetchImpl);
      const safe = all.filter((t) => !isSensitive(t));
      blocked += all.length - safe.length;
      geos[g] = safe.slice(0, 15);
    } catch (e) { errors.push((e as Error).message); geos[g] = []; }
  }
  const radar: TrendRadar = { at: now.toISOString(), geos, blocked, ideas: 0, source: 'none', ...(errors.length ? { error: errors.join(' · ') } : {}) };

  const pool = Object.values(geos).flat();
  const provider = pool.length ? await getAiProvider(s).catch(() => null) : null;
  if (provider && !provider.isDryRun && provider.generateJson) {
    try {
      await assertBudget(s, estimateTextCost(s, 5000, 1500));
      const accounts = await prisma.socialAccount.findMany({ where: { paused: false }, select: { id: true, name: true, handle: true, language: true, businessCategory: true, allowedProductIds: true, allowedCategoryIds: true } });
      const products = await prisma.product.findMany({ where: { active: true }, select: { id: true, titleAr: true, categoryId: true, category: { select: { nameAr: true } } }, take: 120, orderBy: { updatedAt: 'desc' } });
      const market = (a: { handle: string | null; name: string }) => (/ksa|saudi|سعود/i.test(`${a.handle ?? ''} ${a.name}`) ? 'SA' : 'BH');
      const r = await provider.generateJson([
        'You are the trend strategist of a print & gift shop in Bahrain (mugs, t-shirts, stickers, banners, cards, gifts; branches Saar and Salmabad).',
        'You get TODAY\'s real Google searches per country. Pick only trends a print shop can join with taste and real relevance (sports wins, celebrations, school, weather, viral fun, launches, seasons, national pride).',
        'NEVER use a trend about death, accidents, disasters, war, politics, crime, religion disputes or any person\'s private tragedy — mark them unsafe.',
        `Return JSON {"ideas":[{"trend":"<exact trend title>","accountId":"...","productId":"...","title":"<short Arabic title>","idea":"<the idea in Arabic, 1-2 sentences>","hook":"<first-3-seconds hook in Gulf Arabic>","format":"${IDEA_FORMATS.join('|')}","score":1-10,"why":"<why it fits, Arabic>"}]} — at most ${s.trends.ideasPerDay} ideas, the best first. Saudi trends only for Saudi accounts (market SA), Bahraini trends for Bahraini accounts. Use only the ids given. If nothing fits, return {"ideas":[]}.`,
      ].join('\n'), JSON.stringify({ trends: pool.map((t) => ({ title: t.title, country: t.geo, searches: t.traffic, news: t.news })), accounts: accounts.map((a) => ({ id: a.id, name: a.name, market: market(a), language: a.language, business: a.businessCategory })), products: products.map((p) => ({ id: p.id, name: p.titleAr, category: p.category.nameAr })) }), s.ai.textModel);
      await recordUsage({ provider: provider.name, model: r.model, kind: 'text', inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, costUsd: estimateTextCost(s, r.usage.inputTokens, r.usage.outputTokens) });
      const titles = new Set(pool.map((t) => t.title));
      type Raw = { trend?: string; accountId?: string; productId?: string; title?: string; idea?: string; hook?: string; format?: string; score?: number; why?: string };
      for (const i of (((r.json as { ideas?: Raw[] })?.ideas ?? []) as Raw[]).slice(0, s.trends.ideasPerDay)) {
        const acc = accounts.find((a) => a.id === i.accountId), pr = products.find((p) => p.id === i.productId);
        if (!acc || !pr || !i.trend || !titles.has(i.trend) || !i.title?.trim() || !i.idea?.trim()) continue; // never trust ids or trends the model made up
        if (!productAllowed(acc, pr) || isSensitive({ title: `${i.trend} ${i.title} ${i.idea}`, news: [] })) continue;
        if (await prisma.idea.findFirst({ where: { accountId: acc.id, source: 'trend', occasion: i.trend.slice(0, 120), createdAt: { gte: new Date(now.getTime() - 3 * 86400_000) } } })) continue;
        const t = pool.find((x) => x.title === i.trend)!;
        await prisma.idea.create({ data: { accountId: acc.id, productId: pr.id, title: i.title.slice(0, 120), idea: i.idea.slice(0, 500), hook: i.hook?.slice(0, 160) ?? null, angle: 'trend', format: (IDEA_FORMATS as readonly string[]).includes(i.format ?? '') ? i.format! : 'REEL_VIDEO', occasion: i.trend.slice(0, 120), score: typeof i.score === 'number' ? Math.max(1, Math.min(10, i.score)) : null, why: `🔥 ترند في ${GEO_AR[t.geo] ?? t.geo} (${t.traffic || 'بحث مرتفع'}) — ${i.why ?? ''}`.slice(0, 300), language: acc.language, source: 'trend', status: 'NEW' } });
        radar.ideas++;
      }
      radar.source = 'ai';
    } catch (e) { log.warn('trends.ai_failed', { error: (e as Error).message }); radar.error = [radar.error, 'AI: ' + (e as Error).message].filter(Boolean).join(' · '); }
  } else if (pool.length) radar.source = 'numbers';

  await prisma.systemSetting.upsert({ where: { key: 'trends:last' }, create: { key: 'trends:last', value: radar as unknown as Prisma.InputJsonValue, updatedBy: 'trends' }, update: { value: radar as unknown as Prisma.InputJsonValue, updatedBy: 'trends' } });
  if (radar.ideas) await notify('INFO', 'TREND_IDEAS', `🔥 ${radar.ideas} أفكار من ترند اليوم`, 'في «رادار الترند» و«بنك الأفكار» — اعتمد ما يعجبك قبل أن يبرد الترند (تنتهي بعد ٣ أيام).').catch(() => undefined);
  await audit({ actorLabel: 'trends', action: 'trends.run', details: { geos: Object.keys(geos), trends: pool.length, blocked, ideas: radar.ideas } }).catch(() => undefined);
  return radar;
}
