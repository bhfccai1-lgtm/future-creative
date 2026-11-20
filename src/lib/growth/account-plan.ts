import { prisma } from '../db';
import { audit } from '../audit';
import { AppError } from '../errors';
import { marketOf, upcomingOccasions } from '../creative/planner';
import { OCCASIONS } from '../creative/options';

/**
 * «خطة الحسابات» — the content strategist for every account, built from the REAL numbers the system imports from
 * Metricool for its own verified publications (reach, views, saves, shares, comments, retention, skip rate).
 *  - the best post and the metric it stood out in; opening hooks (question vs statement) against the skip rate;
 *    posting frequency against reach; language / market / focus problems
 *  - 5 ideas built on what worked (sequel of the best post, product-first opening, the next occasion, a saveable guide,
 *    before/after) — executed through the idea bank: «اعتمد الأفكار» puts them in the bank for the automatic schedule,
 *    «صمّم الآن» designs one immediately (both go through the normal approval / autonomy rules)
 *  - a ready bio and three reply messages in the account's language
 * Numbers are what the provider reported; every interpretation is labelled as such in the page. Nothing is published here.
 */
type M = { reach?: number; views?: number; likes?: number; comments?: number; saves?: number; shares?: number; retentionPct?: number; skipRatePct?: number };
export interface PlanPost {
  adId: string; hook: string; headline: string | null; format: string; publishedAt: string; product: string; category: string;
  views: number; reach: number; likes: number; comments: number; saves: number; shares: number; retention: number | null; skip: number | null;
}
export interface PlanIssue { id: string; level: 'high' | 'medium' | 'info'; text: string; fix: string }
export interface PlanIdea { key: string; title: string; idea: string; hook: string; format: string; productId: string; occasion?: string; why: string; inBank?: boolean }
export interface AccountPlan {
  account: { id: string; name: string; handle: string | null; language: string; market: 'BH' | 'KSA' };
  days: number; posts: number; measured: number;
  totals: { views: number; reach: number; saves: number; shares: number; comments: number; likes: number; retention: number | null; skip: number | null };
  top: (PlanPost & { reason: string }) | null;
  hooks: { question: { n: number; skip: number | null }; statement: { n: number; skip: number | null } };
  frequency: { first: { posts: number; avgViews: number | null }; second: { posts: number; avgViews: number | null } } | null;
  issues: PlanIssue[]; ideas: PlanIdea[]; bio: string; messages: string[]; recent: PlanPost[];
  /** 🧠 what the account's brain learnt from its numbers (null = not enough data yet) */
  brain: { at: string; posts: number; rules: { ar: string; lift: number; nBest: number; nWorst: number }[] } | null;
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
/** the numeric fields of a post from a provider metrics object — one place for the metric names (plan, brain, Drive) */
export function metricFields(raw: unknown, o: { roundRates?: boolean } = {}) {
  const m = (raw ?? {}) as M, round = o.roundRates ?? true;
  const rate = (v: unknown) => (typeof v === 'number' ? (round ? Math.round(v) : v) : null);
  return { views: n(m.views), reach: n(m.reach), likes: n(m.likes), comments: n(m.comments), saves: n(m.saves), shares: n(m.shares), retention: rate(m.retentionPct), skip: rate(m.skipRatePct) };
}
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
const firstLine = (c: string | null) => (c ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
export const isQuestion = (hook: string) => /[؟?]\s*[\p{Extended_Pictographic}\s]*$/u.test(hook);
/** the script a text is written in (for the language check) */
export function scriptOf(t: string): 'ar' | 'ml' | 'en' | null {
  const ar = (t.match(/[؀-ۿ]/g) ?? []).length, ml = (t.match(/[ഀ-ൿ]/g) ?? []).length, en = (t.match(/[A-Za-z]/g) ?? []).length;
  const max = Math.max(ar, ml, en); if (max < 12) return null;
  return max === ml ? 'ml' : max === ar ? 'ar' : 'en';
}
/** the one feature a customer can see, per product category (what the first second of a reel should show) */
const FEATURE: Record<string, string> = {
  drinkware: 'وضوح الاسم على انحناءة الكوب', 'stickers-labels': 'دقة القص لحظة نزع الاستيكر', 'signage-decor': 'التفاف الصورة على حافة الكانفس أو لمعة الأكريليك',
  apparel: 'الطباعة على القماش عن قرب', 'events-weddings': 'تفاصيل لوحة الترحيب أو البطاقة عن قرب', education: 'الورقة وهي تُستخدم بيد الطالب',
  corporate: 'ملمس الكرت والتشطيب الذهبي', packaging: 'لحظة فتح العبوة', 'print-marketing': 'المطوية وهي تنفتح طيّة بعد طيّة', 'large-format': 'البنر وهو يُرفع في مكانه', gifts: 'لحظة تسليم الهدية بالاسم عليها',
};
/** a post's quality for ranking: retained views first, then the strongest reach signals (sends, saves, comments) */
export const postScore = (p: PlanPost) => p.views * ((p.retention ?? 30) / 100) + p.saves * 6 + p.shares * 8 + p.comments * 5 + p.likes * 0.5;

function bioFor(lang: string, cats: string[], ksa: boolean) {
  const what = cats.slice(0, 3).join(' · ') || 'طباعة وهدايا مخصصة';
  if (lang === 'en' || lang === 'ml') return `Custom printing in Bahrain${ksa ? ' — delivered to Saudi Arabia' : ''}\n${what}\n📩 DM your idea + quantity\n📍 Saar 33316319 | Salmabad 34315316`;
  return `${ksa ? '🇸🇦 طباعة مخصصة لعملاء المملكة' : '🖨️ مطبعة إبداع المستقبل — البحرين'}\n${what}\n📩 أرسل فكرتك على الخاص ونجهز لك التصميم\n📍 سار 33316319 | سلماباد 34315316`;
}
function messagesFor(lang: string, product: string) {
  if (lang === 'en' || lang === 'ml') return [
    `Hi 🌷 thanks for your comment on our ${product}! Is it for you or a gift?`,
    'Lovely! When do you need it? So we can plan the right date ☕',
    'Then I recommend [the right option] because [what you will see]. Send me the name / photo / logo and we will share the design for approval before printing. Price: [price]. Pick-up at Saar or Salmabad. Does that work?',
  ];
  return [
    `هلا والله 🌷 شكرًا على تعليقك على ${product}! تبيه لك ولا هدية؟`,
    'حلو! متى تحتاجه؟ عشان نرتب لك الموعد المناسب ☕',
    'ممتاز، أنصحك بـ[الخيار المناسب] لأنه [الميزة اللي بتشوفها]. دز لي الاسم أو الصورة أو الشعار ونرسل لك التصميم تشوفه قبل الطباعة. السعر [السعر]، والاستلام من سار أو سلماباد. يناسبك؟',
  ];
}

export async function accountPlans(opts: { now?: Date; days?: number; accountId?: string } = {}): Promise<AccountPlan[]> {
  const now = opts.now ?? new Date(), days = opts.days ?? 30;
  const since = new Date(now.getTime() - days * 86400_000);
  const accounts = await prisma.socialAccount.findMany({ where: { ...(opts.accountId ? { id: opts.accountId } : {}) }, orderBy: { name: 'asc' } });
  const occasions = upcomingOccasions(now, 45);
  const out: AccountPlan[] = [];
  for (const acc of accounts) {
    const market = marketOf(acc);
    const jobs = await prisma.publicationJob.findMany({
      where: { accountId: acc.id, primary: true, result: { verifiedAt: { gte: since } } },
      include: { result: true, advertisement: { select: { id: true, caption: true, headline: true, format: true, product: { select: { id: true, titleAr: true, titleEn: true, category: { select: { slug: true, nameAr: true } } } } } } },
      orderBy: { scheduledFor: 'asc' },
    });
    const posts: PlanPost[] = jobs.map((j) => {
      const ad = j.advertisement;
      return {
        adId: ad.id, hook: firstLine(ad.caption).slice(0, 140), headline: ad.headline, format: ad.format, publishedAt: (j.result?.verifiedAt ?? j.scheduledFor).toISOString(),
        product: acc.language === 'ar' ? ad.product.titleAr : ad.product.titleEn ?? ad.product.titleAr, category: ad.product.category.slug,
        ...metricFields(j.result?.metrics),
      };
    });
    const measured = jobs.filter((j) => j.result?.metricsFetchedAt).length;
    const withM = posts.filter((_, i) => jobs[i].result?.metricsFetchedAt);
    const sum = (k: keyof PlanPost) => withM.reduce((a, p) => a + n(p[k]), 0);
    const totals = { views: sum('views'), reach: sum('reach'), saves: sum('saves'), shares: sum('shares'), comments: sum('comments'), likes: sum('likes'), retention: avg(withM.map((p) => p.retention).filter((x): x is number => x !== null)), skip: avg(withM.map((p) => p.skip).filter((x): x is number => x !== null)) };
    const ranked = [...withM].sort((a, b) => postScore(b) - postScore(a));
    const best = ranked[0] ?? null;
    const top = best ? { ...best, reason: [
      best.views === Math.max(...withM.map((p) => p.views)) ? 'أعلى مشاهدات' : '',
      best.retention !== null && best.retention >= (totals.retention ?? 0) + 10 ? `إكمال ${best.retention}٪ (متوسط الحساب ${totals.retention}٪)` : '',
      best.saves + best.shares + best.comments > 0 ? `${best.saves} حفظ · ${best.shares} مشاركة · ${best.comments} تعليق` : '',
    ].filter(Boolean).join(' · ') || 'أعلى مشاهدات محتفظ بها' } : null;
    const q = withM.filter((p) => p.skip !== null && isQuestion(p.hook)), st = withM.filter((p) => p.skip !== null && !isQuestion(p.hook));
    const hooks = { question: { n: q.length, skip: avg(q.map((p) => p.skip!)) }, statement: { n: st.length, skip: avg(st.map((p) => p.skip!)) } };
    let frequency: AccountPlan['frequency'] = null;
    if (withM.length >= 6) {
      const mid = since.getTime() + (now.getTime() - since.getTime()) / 2;
      const a = withM.filter((p) => new Date(p.publishedAt).getTime() < mid), b = withM.filter((p) => new Date(p.publishedAt).getTime() >= mid);
      frequency = { first: { posts: a.length, avgViews: avg(a.map((p) => p.views)) }, second: { posts: b.length, avgViews: avg(b.map((p) => p.views)) } };
    }

    // ── problems, each with the fix ──
    const issues: PlanIssue[] = [];
    if (measured < 3) issues.push({ id: 'little_data', level: 'info', text: `${measured} منشور فقط بأرقام من Metricool خلال ${days} يومًا — الخطة مبدئية.`, fix: 'استمر بالنشر؛ الأرقام تُستورد تلقائيًا كل يوم.' });
    const pushed = withM.filter((p) => p.reach >= 60 && p.skip !== null);
    const pushedSkip = avg(pushed.map((p) => p.skip!));
    if (pushed.length >= 2 && pushedSkip !== null && pushedSkip >= 75) issues.push({ id: 'hook', level: 'high', text: `${pushed.length} ريلز عرضها إنستغرام على ${'≥'}60 شخصًا، لكن ${pushedSkip}٪ تخطوها في أول ٣ ثوانٍ.`, fix: 'أول ثانية تُظهر المنتج والميزة على الشاشة؛ السؤال إن وُجد يأتي بعدها.' });
    if (withM.length >= 5 && totals.comments + totals.shares === 0) issues.push({ id: 'no_conversation', level: 'medium', text: `صفر تعليقات ومشاركات في ${withM.length} منشورًا.`, fix: 'سؤال اختيار حقيقي في آخر الريل («أي وحدة تختار: ١ ولا ٢؟») ومحتوى يُرسل لصديق.' });
    if (frequency && frequency.first.avgViews && frequency.second.avgViews !== null && frequency.second.posts >= frequency.first.posts * 1.8 && frequency.second.avgViews <= frequency.first.avgViews * 0.6)
      issues.push({ id: 'frequency', level: 'medium', text: `النشر تضاعف (${frequency.first.posts} ← ${frequency.second.posts}) والمشاهدات للمنشور نزلت (${frequency.first.avgViews} ← ${frequency.second.avgViews}).`, fix: 'منشور إلى منشورين يوميًا، الريلز أولًا (ارتباط في الأرقام، ليس سببًا مثبتًا).' });
    const wrongLang = posts.filter((p) => { const s = scriptOf(p.hook); return s !== null && s !== acc.language && !(acc.language === 'ml' && s === 'en'); }).length;
    if (wrongLang) issues.push({ id: 'language', level: 'high', text: `${wrongLang} منشور بلغة غير لغة الحساب.`, fix: 'منشورات هذه اللغة تذهب لحسابها المخصص؛ لغة واحدة لكل حساب.' });
    if (market === 'KSA') {
      const leaked = jobs.filter((j) => /#\S*(بحرين|bahrain)/i.test(j.advertisement.caption ?? '')).length;
      if (leaked) issues.push({ id: 'ksa_tags', level: 'high', text: `${leaked} منشور في حساب السعودية بوسوم البحرين.`, fix: 'مُصلح تلقائيًا للمنشورات الجديدة (بوابة الخوارزمية تحذفها وتضيف #السعودية).' });
    }
    const cats = new Map<string, number>(); for (const p of posts) cats.set(p.category, (cats.get(p.category) ?? 0) + 1);
    if (cats.size >= 5) issues.push({ id: 'focus', level: 'medium', text: `${cats.size} أنواع منتجات مختلفة في ${posts.length} منشورًا — الزائر لا يعرف تخصص الحساب.`, fix: 'حدّد ٢–٣ فئات في «الحسابات الاجتماعية ← المنتجات المسموحة».' });

    // ── ideas built on what worked ──
    const productIds = new Map<string, { id: string; name: string; cat: string; score: number }>();
    for (const [i, p] of posts.entries()) {
      const pid = jobs[i].advertisement.product.id; const cur = productIds.get(pid);
      productIds.set(pid, { id: pid, name: p.product, cat: p.category, score: (cur?.score ?? 0) + postScore(p) });
    }
    let main = [...productIds.values()].sort((a, b) => b.score - a.score)[0];
    if (!main) {
      const pr = await prisma.product.findFirst({ where: { active: true, ...(acc.allowedProductIds.length ? { id: { in: acc.allowedProductIds } } : {}) }, include: { category: { select: { slug: true } } } });
      if (pr) main = { id: pr.id, name: acc.language === 'ar' ? pr.titleAr : pr.titleEn ?? pr.titleAr, cat: pr.category.slug, score: 0 };
    }
    const ideas: PlanIdea[] = [];
    if (main) {
      const feature = FEATURE[main.cat] ?? 'تفاصيل الطباعة عن قرب';
      if (best) ideas.push({ key: 'sequel', title: 'الجزء الثاني من أفضل منشور', idea: `نفس روح «${best.hook.slice(0, 70)}» بزاوية تصوير مختلفة، وأول لقطة تُظهر ${best.product} مباشرة`, hook: best.hook.slice(0, 80), format: best.format, productId: main.id, why: `أفضل منشور في الحساب (${top?.reason ?? ''})` });
      ideas.push({ key: 'product_first', title: 'المنتج أولًا', idea: `افتتاحية بلقطة قريبة جدًا تُظهر ${feature} في أول ثانية، ثم السياق والفائدة، ونهاية تعود للقطة الأولى`, hook: `شوفوا ${feature.split(' ').slice(0, 3).join(' ')} من قريب`, format: 'REEL_VIDEO', productId: main.id, why: 'أقل معدل تخطٍّ في الحسابات كان للريلز التي تبدأ بالمنتج نفسه' });
      const occ = occasions.find((o) => (!o.market || o.market === market) && (!o.langs || o.langs.includes(acc.language)) && OCCASIONS.some((x) => x.value === o.key) && o.daysToPeak >= 3);
      if (occ) { const label = OCCASIONS.find((x) => x.value === occ.key)!.ar; ideas.push({ key: `occasion_${occ.key}`, title: label, idea: `${main.name} بطابع ${label}، والميزة (${feature}) واضحة في أول لقطة`, hook: `جاهزين لـ${label.split('(')[0].trim()}؟`, format: 'REEL_VIDEO', productId: main.id, occasion: occ.key, why: `بعد ${occ.daysToPeak} يومًا — انشر قبلها بأسبوع` }); }
      ideas.push({ key: 'guide', title: 'دليل اختيار يُحفظ', idea: `كاروسيل من ٥ شرائح: كيف تختار ${main.name} المناسب (الخامة، المقاس، التصميم، الكمية، طريقة الطلب)`, hook: `قبل لا تطلب ${main.name}… اقرأ هذا`, format: 'IMAGE_CAROUSEL', productId: main.id, why: 'الأدلة المفيدة هي أكثر ما يُحفظ ويُرسل' });
      ideas.push({ key: 'before_after', title: 'قبل وبعد', idea: `${main.name} من فكرة على الجوال إلى قطعة مطبوعة بين اليدين، في ٣ لقطات سريعة`, hook: 'من فكرة… إلى هذا', format: 'REEL_VIDEO', productId: main.id, why: 'قصة قصيرة تُشاهد حتى النهاية وتتكرر' });
    }
    // ideas already in the bank (approved / used from this plan) are marked
    const inBank = new Set((await prisma.idea.findMany({ where: { accountId: acc.id, source: 'plan', createdAt: { gte: since } }, select: { title: true } })).map((x) => x.title));
    for (const i of ideas) i.inBank = inBank.has(i.title);
    const catNames = [...new Set((await prisma.productCategory.findMany({ where: { slug: { in: [...cats.keys()] } }, select: { nameAr: true, nameEn: true } })).map((c) => (acc.language === 'ar' ? c.nameAr : c.nameEn)))];
    out.push({
      account: { id: acc.id, name: acc.name, handle: acc.handle, language: acc.language, market }, days, posts: posts.length, measured, totals, top, hooks, frequency, issues, ideas,
      bio: bioFor(acc.language, catNames, market === 'KSA'), messages: messagesFor(acc.language, main?.name ?? (acc.language === 'ar' ? 'منتجنا' : 'our product')),
      recent: [...posts].reverse().slice(0, 9),
      brain: await (async () => { const b = await (await import('./brain')).brainOf(acc.id); return b ? { at: b.at, posts: b.posts, rules: b.rules.map((r) => ({ ar: r.ar, lift: r.lift, nBest: r.nBest, nWorst: r.nWorst })) } : null; })(),
    });
  }
  return out;
}

/** «اعتمد الأفكار»: the chosen plan ideas go into the idea bank as APPROVED — the automatic schedule designs them */
export async function approvePlanIdeas(accountId: string, ideas: PlanIdea[], actor: { sub: string; email: string }) {
  const acc = await prisma.socialAccount.findUnique({ where: { id: accountId } });
  if (!acc) throw new AppError('NOT_FOUND', 'الحساب غير موجود', 404);
  const ids: string[] = [];
  for (const i of ideas.slice(0, 10)) {
    const dup = await prisma.idea.findFirst({ where: { accountId, source: 'plan', title: i.title, status: { in: ['NEW', 'APPROVED'] } } });
    if (dup) { ids.push(dup.id); continue; }
    const product = await prisma.product.findUnique({ where: { id: i.productId } });
    if (!product) continue;
    const row = await prisma.idea.create({ data: { accountId, productId: product.id, title: i.title.slice(0, 120), idea: i.idea.slice(0, 500), hook: i.hook.slice(0, 160), format: i.format, occasion: i.occasion ?? null, why: i.why.slice(0, 300), language: acc.language, status: 'APPROVED', source: 'plan' } });
    ids.push(row.id);
  }
  await audit({ actorId: actor.sub, actorLabel: actor.email, action: 'plan.ideas.approve', targetType: 'social_account', targetId: accountId, details: { count: ids.length } });
  return { ids };
}

/** the plan's ideas picked by key — recomputed on the server, never trusted from the browser */
export async function planIdeasByKey(accountId: string, keys: string[]) {
  const [plan] = await accountPlans({ accountId });
  if (!plan) throw new AppError('NOT_FOUND', 'الحساب غير موجود', 404);
  const chosen = plan.ideas.filter((i) => keys.includes(i.key));
  if (!chosen.length) throw new AppError('NO_IDEAS', 'اختر فكرة واحدة على الأقل.', 422);
  return chosen;
}
