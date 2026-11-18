import { prisma } from '../db';
import type { AccountInsight, InsightsSnapshot } from '../analytics/account-insights';
import type { Tier } from '../analytics/posting-plan';

/**
 * «برنامج النمو 30 يومًا» — one program for the chosen accounts:
 *  1) diagnosis from the REAL Metricool numbers (audience share, reach rate, engagement, saves/shares, Reels vs images, consistency)
 *  2) realistic targets per account (modest by design — targets, not promises)
 *  3) four weekly phases; while the program runs the design generator takes its content angle from the current week
 *  4) progress: baseline → now → target, designs made / published, weekly report to the owner.
 * Starting it applies the posting plan (rhythm + format mix). Publishing still follows the approval mode — nothing is
 * published without the approval / authorised-autonomy workflow.
 */
const KEY = 'growth:program';
export const PROGRAM_DAYS = 30;

export interface Baseline { followers: number | null; reachPerContent: number; content: number; reelAvg: number; postAvg: number; engagementRate: number | null; reachRate: number | null }
export interface Targets { followers: number | null; reachPerContent: number | null; contents: number }
export interface Finding { kind: 'strength' | 'weakness' | 'opportunity'; text: string }
export interface AccountProgram { accountId: string; name: string; tier: Tier; baseline: Baseline; targets: Targets; findings: Finding[] }
export interface GrowthProgram { startedAt: string; endsAt: string; by: string; accounts: AccountProgram[]; reports: { week: number; at: string }[] }

export interface Phase { week: number; title: string; goal: string; contentTypes: string[]; actions: string[]; kpi: string }
export const PHASES: Phase[] = [
  { week: 1, title: 'الأساس والانتظام', goal: 'إيقاظ الحسابات: نشر يومي منتظم بالريلز أولًا حتى تعود الخوارزمية لعرض المحتوى.',
    contentTypes: ['product_showcase', 'quality_craft', 'real_use'],
    actions: ['اعتمد تصاميم كل يوم من طابور الموافقات دون تأخير', 'حدّث البايو: ماذا تطبع + الفرعين + رابط واتساب', 'ثبّت أفضل 3 منشورات أعلى كل حساب', 'غلاف موحّد للهايلايت (الأعمال، الأسعار عند الطلب، الفروع)'],
    kpi: 'الاستمرارية: عدد المنشورات مقابل الهدف' },
  { week: 2, title: 'التفاعل والثقة', goal: 'تحويل المشاهدات إلى تفاعل: أسئلة، نصائح، ومن داخل المطبعة.',
    contentTypes: ['educational_tip', 'behind_scenes', 'real_use'],
    actions: ['ستوري يومي فيه استفتاء أو سؤال', 'رد على كل تعليق خلال ساعتين (صفحة التعليقات)', 'اطلب الحفظ والمشاركة في نص المنشور', 'صوّر 3 مقاطع قصيرة حقيقية من المطبعة وارفعها للمكتبة'],
    kpi: 'معدل التفاعل (تفاعل ÷ وصول) والحفظ والمشاركة' },
  { week: 3, title: 'مضاعفة الناجح', goal: 'تكرار ما أثبت نجاحه بالأرقام ونقل جمهور الحسابات الكبيرة للصغيرة.',
    contentTypes: ['product_showcase', 'gift_idea', 'quality_craft'],
    actions: ['استخدم «ضاعف الناجح» لأفضل منشورين في كل حساب كبير', 'فعّل ستوري الترويج المتبادل من الحسابات الكبيرة', 'انشر في أوقات الذروة (النمو ← أوقات الذروة)', 'أوقف الأفكار والأساليب التي ترفضها مرارًا'],
    kpi: 'متوسط الوصول لكل منشور مقابل البداية' },
  { week: 4, title: 'الطلبات والتحويل', goal: 'تحويل الاهتمام إلى طلبات: هدايا، هوية الشركات، دعوة واضحة للطلب.',
    contentTypes: ['gift_idea', 'business_branding', 'occasion_greeting'],
    actions: ['ريل «أعمال منجزة» لعميل حقيقي (بإذنه)', 'دعوة «اطلب الآن» + رقمي الفرعين في كل منشور', 'رد سريع على رسائل الاستفسار وتتبّع الطلبات القادمة من إنستغرام', 'راجع نتائج الشهر وقرّر الشهر القادم'],
    kpi: 'الاستفسارات والطلبات + نمو المتابعين' },
];

const r1 = (n: number) => Math.round(n * 10) / 10;
export function baselineOf(a: AccountInsight): Baseline {
  const content = a.posts.count + a.reels.count, reach = a.posts.reach + a.reels.reach, inter = a.posts.interactions + a.reels.interactions;
  const rpc = content ? reach / content : 0;
  return { followers: a.followers, reachPerContent: r1(rpc), content, reelAvg: a.reels.avgReach, postAvg: a.posts.avgReach,
    engagementRate: reach ? r1((inter / reach) * 100) : null, reachRate: a.followers && content ? r1((rpc / a.followers) * 100) : null };
}

/** Modest, explainable targets for 30 days. */
export function targetsFor(tier: Tier, b: Baseline, contentsPlanned: number): Targets {
  const f = b.followers;
  const followers = f == null ? null : tier === 'grow' ? Math.ceil(f * 1.03) : tier === 'light' ? f + Math.max(20, Math.ceil(f * 0.3)) : Math.ceil(f * 1.05);
  const lift = tier === 'grow' ? 1.4 : tier === 'light' ? 1.25 : 1.3;
  return { followers, reachPerContent: b.reachPerContent > 0 ? Math.ceil(b.reachPerContent * lift) : null, contents: Math.round(contentsPlanned) };
}

/** Plain-language diagnosis — every line comes from a number in the snapshot. */
export function diagnose(a: AccountInsight, snap: InsightsSnapshot): Finding[] {
  const out: Finding[] = [];
  const b = baselineOf(a);
  const total = snap.totals.followers;
  if (a.followers != null && total > 0) {
    const share = Math.round((a.followers / total) * 100);
    if (share >= 15 && b.content <= 6) out.push({ kind: 'opportunity', text: `يملك ${share}% من كل جمهورك لكن نُشر عليه ${b.content} فقط خلال ${snap.days} يومًا — أكبر فرصة نمو سريعة.` });
    else if (share >= 15) out.push({ kind: 'strength', text: `يملك ${share}% من جمهورك — حساب رئيسي.` });
  }
  if (b.reachRate != null) {
    if (b.reachRate < 2) out.push({ kind: 'weakness', text: `كل منشور يصل إلى ${b.reachRate}% فقط من المتابعين (~${b.reachPerContent} وصول) — الحساب «نائم» عند الخوارزمية.` });
    else if (b.reachRate >= 10) out.push({ kind: 'strength', text: `الوصول ${b.reachRate}% من المتابعين لكل منشور — ممتاز.` });
  }
  if (a.reels.count >= 2 && a.posts.count >= 2 && a.posts.avgReach > 0) {
    const x = a.reels.avgReach / a.posts.avgReach;
    if (x >= 2) out.push({ kind: 'strength', text: `الريل يصل ×${x.toFixed(1)} من الصورة (${a.reels.avgReach} مقابل ${a.posts.avgReach}).` });
    else if (x < 1) out.push({ kind: 'weakness', text: `الريلز تصل أقل من الصور هنا (${a.reels.avgReach} مقابل ${a.posts.avgReach}) — الافتتاحية (أول ثانيتين) تحتاج تقوية.` });
  } else if (a.reels.count === 0 && b.content > 0) out.push({ kind: 'opportunity', text: 'لا يوجد ريلز — الريلز هي أسرع طريق للوصول لغير المتابعين.' });
  if (b.engagementRate != null && b.content >= 3) {
    if (b.engagementRate < 2) out.push({ kind: 'weakness', text: `التفاعل ${b.engagementRate}% من الوصول — اطلب رأي الجمهور واسأل في النص والستوري.` });
    else if (b.engagementRate >= 6) out.push({ kind: 'strength', text: `تفاعل قوي: ${b.engagementRate}% من الوصول.` });
  }
  if (b.content >= 3 && a.saves + a.shares === 0) out.push({ kind: 'weakness', text: 'لا حفظ ولا مشاركة — أضف محتوى مفيدًا يُحفظ (نصائح، أفكار هدايا).' });
  else if (a.saves + a.shares >= 10) out.push({ kind: 'strength', text: `${a.saves} حفظ و${a.shares} مشاركة — المحتوى يستحق الحفظ.` });
  if (b.content === 0) out.push({ kind: 'weakness', text: `لم يُنشر شيء خلال ${snap.days} يومًا.` });
  if (a.followers != null && a.followers < 50) out.push({ kind: 'opportunity', text: 'جمهور صغير — يحتاج ستوري ترويج من الحسابات الكبيرة أكثر من كثرة المنشورات.' });
  return out;
}

export function weekOf(p: Pick<GrowthProgram, 'startedAt' | 'endsAt'>, now = new Date()): number | 'done' {
  if (now.getTime() >= new Date(p.endsAt).getTime()) return 'done';
  const day = Math.floor((now.getTime() - new Date(p.startedAt).getTime()) / 86400_000);
  return Math.min(4, Math.max(1, Math.floor(day / 7) + 1));
}
export const dayOf = (p: Pick<GrowthProgram, 'startedAt'>, now = new Date()) => Math.min(PROGRAM_DAYS, Math.max(1, Math.floor((now.getTime() - new Date(p.startedAt).getTime()) / 86400_000) + 1));

export async function loadProgram(): Promise<GrowthProgram | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: KEY } });
  return (row?.value as unknown as GrowthProgram) ?? null;
}
export async function saveProgram(p: GrowthProgram | null) {
  if (!p) { await prisma.systemSetting.deleteMany({ where: { key: KEY } }); return; }
  await prisma.systemSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: p as unknown as object }, update: { value: p as unknown as object } });
}

/** Content angles of the running week for this account (empty when no program / account not in it / finished). */
export async function programContentTypes(accountId: string, now = new Date()): Promise<string[]> {
  const p = await loadProgram().catch(() => null);
  if (!p || !p.accounts.some((a) => a.accountId === accountId)) return [];
  const w = weekOf(p, now);
  return w === 'done' ? [] : PHASES[w - 1].contentTypes;
}

/** Least-recently used angle from the week's list (pure). */
export function pickFromWeek(types: string[], recent: (string | null | undefined)[], rng: () => number = Math.random): string {
  const last = recent.filter(Boolean).slice(0, Math.max(1, types.length - 1));
  const pool = types.filter((t) => !last.includes(t));
  const list = pool.length ? pool : types;
  return list[Math.floor(rng() * list.length)];
}

export interface Progress { accountId: string; followersNow: number | null; reachNow: number | null; made: number; published: number; leads: number; orders: number; pctFollowers: number | null; pctReach: number | null; pctContent: number }
/** Progress toward each target; the "now" numbers come from the latest snapshot (30-day window). */
export async function programProgress(p: GrowthProgram, snap: InsightsSnapshot | null): Promise<Progress[]> {
  const since = new Date(p.startedAt);
  const ids = p.accounts.map((a) => a.accountId);
  const [made, pub, leads, orders] = await Promise.all([
    prisma.advertisement.groupBy({ by: ['accountId'], _count: true, where: { accountId: { in: ids }, createdAt: { gte: since }, state: { notIn: ['FAILED', 'REJECTED'] } } }),
    prisma.publicationJob.groupBy({ by: ['accountId'], _count: true, where: { accountId: { in: ids }, state: 'PUBLISHED', primary: true, scheduledFor: { gte: since } } }),
    prisma.lead.groupBy({ by: ['accountId'], _count: true, where: { accountId: { in: ids }, createdAt: { gte: since } } }),
    prisma.lead.groupBy({ by: ['accountId'], _count: true, where: { accountId: { in: ids }, status: 'WON', wonAt: { gte: since } } }),
  ]);
  const pct = (b: number | null, now: number | null, t: number | null) => (b == null || now == null || t == null || t === b ? null : Math.max(0, Math.min(100, Math.round(((now - b) / (t - b)) * 100))));
  return p.accounts.map((a) => {
    const s = snap?.accounts.find((x) => x.accountId === a.accountId && !x.error);
    const nowB = s ? baselineOf(s) : null;
    const published = pub.find((x) => x.accountId === a.accountId)?._count ?? 0;
    return {
      accountId: a.accountId, followersNow: nowB?.followers ?? null, reachNow: nowB ? nowB.reachPerContent : null,
      made: made.find((x) => x.accountId === a.accountId)?._count ?? 0, published,
      leads: leads.find((x) => x.accountId === a.accountId)?._count ?? 0, orders: orders.find((x) => x.accountId === a.accountId)?._count ?? 0,
      pctFollowers: pct(a.baseline.followers, nowB?.followers ?? null, a.targets.followers),
      pctReach: pct(a.baseline.reachPerContent, nowB?.reachPerContent ?? null, a.targets.reachPerContent),
      pctContent: a.targets.contents ? Math.min(100, Math.round((published / a.targets.contents) * 100)) : 0,
    };
  });
}
