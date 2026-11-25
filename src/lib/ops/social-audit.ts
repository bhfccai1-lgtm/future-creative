import { prisma } from '../db';
import { env } from '../env';
import type { Advice } from './advisor';

/**
 * Platform expert audit (Instagram, Facebook, TikTok, YouTube, Google Business Profile, search engines) over the
 * posts this system REALLY published in the last 30 days and their imported metrics. Benchmarks are the platforms'
 * own public guidance (e.g. Instagram: 3–5 relevant hashtags, the first ~125 caption characters show before «more»,
 * keywords in captions make posts searchable); where no trustworthy benchmark exists the value is shown without a
 * verdict instead of an invented one. Nothing is estimated; no AI call, no cost.
 */
export type CheckStatus = 'good' | 'warn' | 'bad' | 'na';
export interface PlatformCheck { id: string; label: string; status: CheckStatus; value: string; benchmark: string }
export interface PlatformCard { key: string; title: string; score: number | null; posts: number; checks: PlatformCheck[] }
export interface SocialAudit { at: string; cards: PlatformCard[]; advice: Advice[] }

// ───────────────────────── pure helpers (unit-tested) ─────────────────────────
const pct = (a: number, n: number) => (n ? Math.round((a / n) * 100) : 0);
/** Hashtag hygiene: average count, share of posts with none / more than 10, and how often the exact same set repeats. */
export function hashtagStats(sets: string[][]) {
  const n = sets.length;
  const norm = sets.map((s) => [...new Set(s.map((h) => h.replace(/^#/, '').toLowerCase()))].sort().join(' '));
  const freq = new Map<string, number>();
  for (const k of norm) if (k) freq.set(k, (freq.get(k) ?? 0) + 1);
  return {
    n, avg: n ? Math.round((sets.reduce((a, s) => a + s.length, 0) / n) * 10) / 10 : 0,
    zeroPct: pct(sets.filter((s) => !s.length).length, n), over10Pct: pct(sets.filter((s) => s.length > 10).length, n),
    sameSetPct: pct(Math.max(0, ...freq.values()), n),
  };
}
const CTA = /اطلب|اطلبي|راسل|راسلنا|تواصل|واتساب|واتس|احجز|للطلب|order|dm\b|message|whatsapp|book|call|ऑर्डर|संपर्क|ഓർഡർ|വിളിക്കൂ/i;
/** Caption craft: hook within the ~125 characters Instagram shows, a search keyword up front, a call to action. */
export function captionStats(posts: { caption: string; keywords: string[] }[]) {
  const n = posts.length;
  const hookOk = posts.filter((p) => (p.caption.split('\n').find((l) => l.trim()) ?? '').trim().length <= 125).length;
  const kwOk = posts.filter((p) => { const head = p.caption.slice(0, 150).toLowerCase(); return p.keywords.some((k) => k && k.length >= 3 && head.includes(k.toLowerCase())); }).length;
  const ctaOk = posts.filter((p) => CTA.test(p.caption)).length;
  return { n, hookPct: pct(hookOk, n), keywordPct: pct(kwOk, n), ctaPct: pct(ctaOk, n) };
}
/** Posting rhythm over a window: posts per week and the longest silence. */
export function cadence(dates: Date[], days: number, now: Date) {
  const s = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const start = now.getTime() - days * 86400_000;
  let gap = 0, prev = start;
  for (const d of s) { gap = Math.max(gap, d.getTime() - prev); prev = d.getTime(); }
  gap = Math.max(gap, now.getTime() - prev);
  return { perWeek: Math.round((s.length / days) * 7 * 10) / 10, maxGapDays: Math.round(gap / 86400_000) };
}
/** Score 0–100 from the judged checks (good 1, warn ½, bad 0); null when nothing could be judged. */
export function scoreOf(checks: PlatformCheck[]): number | null {
  const j = checks.filter((c) => c.status !== 'na');
  return j.length ? Math.round((j.reduce((a, c) => a + (c.status === 'good' ? 1 : c.status === 'warn' ? 0.5 : 0), 0) / j.length) * 100) : null;
}
const band = (v: number, good: number, warn: number, higherBetter = true): CheckStatus => (higherBetter ? (v >= good ? 'good' : v >= warn ? 'warn' : 'bad') : (v <= good ? 'good' : v <= warn ? 'warn' : 'bad'));

// ───────────────────────── audit ─────────────────────────
type M = { reach?: number; views?: number; saves?: number; shares?: number; profileVisits?: number; follows?: number; retentionPct?: number };

export async function runSocialAudit(now = new Date()): Promise<SocialAudit> {
  const DAYS = 30, since = new Date(now.getTime() - DAYS * 86400_000);
  const [jobs, accounts] = await Promise.all([
    prisma.publicationJob.findMany({
      where: { state: 'PUBLISHED', scheduledFor: { gte: since, lte: now } },
      select: { scheduledFor: true, networks: true, accountId: true, result: { select: { metrics: true } },
        advertisement: { select: { format: true, caption: true, channels: true, brief: { select: { caption: true, hashtags: true } }, product: { select: { titleAr: true, titleEn: true, category: { select: { nameAr: true, nameEn: true } } } } } } },
    }),
    prisma.socialAccount.findMany({ select: { id: true, name: true, platform: true, connection: { select: { providerSnapshot: true } } } }),
  ]);
  const accById = new Map(accounts.map((a) => [a.id, a]));
  const linked = (net: string) => accounts.filter((a) => a.platform === net || ((a.connection?.providerSnapshot as { networks?: { network: string }[] } | null)?.networks ?? []).some((n) => n.network === net));
  const netsOf = (j: (typeof jobs)[number]) => (j.networks.length ? j.networks : j.advertisement.channels.length ? j.advertisement.channels : [accById.get(j.accountId)?.platform ?? 'instagram']) as string[];
  const on = (net: string) => jobs.filter((j) => netsOf(j).includes(net));
  const cards: PlatformCard[] = [];
  const advice: Advice[] = [];
  const card = (key: string, title: string, posts: number, checks: PlatformCheck[]) => cards.push({ key, title, posts, checks, score: scoreOf(checks) });

  // ── Instagram ──
  const ig = on('instagram'), feed = ig.filter((j) => j.advertisement.format !== 'IMAGE_STORY');
  const igChecks: PlatformCheck[] = [];
  if (!ig.length) igChecks.push({ id: 'ig_none', label: 'منشورات خلال 30 يومًا', status: linked('instagram').length ? 'bad' : 'na', value: '0', benchmark: '3–5 أسبوعيًا لكل حساب' });
  else {
    const perAcc = [...new Set(ig.map((j) => j.accountId))].map((id) => ({ id, ...cadence(ig.filter((j) => j.accountId === id && j.advertisement.format !== 'IMAGE_STORY').map((j) => j.scheduledFor), DAYS, now) }));
    const slow = perAcc.filter((a) => a.perWeek < 2);
    const avgWeek = Math.round((perAcc.reduce((a, x) => a + x.perWeek, 0) / perAcc.length) * 10) / 10;
    igChecks.push({ id: 'ig_cadence', label: 'وتيرة النشر في الخلاصة (لكل حساب)', status: slow.length === 0 ? 'good' : slow.length < perAcc.length ? 'warn' : 'bad', value: `${avgWeek} أسبوعيًا · أطول انقطاع ${Math.max(...perAcc.map((a) => a.maxGapDays))} يوم`, benchmark: '3–5 أسبوعيًا بلا انقطاع > 7 أيام' });
    const reels = feed.filter((j) => j.advertisement.format === 'REEL_VIDEO').length, carousels = feed.filter((j) => j.advertisement.format === 'IMAGE_CAROUSEL').length;
    igChecks.push({ id: 'ig_reels_share', label: 'نسبة الريلز من منشورات الخلاصة', status: feed.length ? band(pct(reels, feed.length), 40, 20) : 'na', value: `${pct(reels, feed.length)}٪ (${reels}/${feed.length})`, benchmark: '≥ 40٪ — الريلز تصل لغير المتابعين' });
    igChecks.push({ id: 'ig_carousel', label: 'كاروسيل (يرفع الحفظ والوقت على المنشور)', status: feed.length ? (carousels ? 'good' : 'warn') : 'na', value: `${carousels}`, benchmark: '1–2 أسبوعيًا على الأقل' });
    const tags = hashtagStats(feed.map((j) => j.advertisement.brief?.hashtags ?? []));
    igChecks.push({ id: 'ig_hashtags', label: 'عدد الهاشتاغات للمنشور', status: tags.over10Pct > 20 ? 'bad' : tags.avg < 1 ? 'warn' : tags.avg <= 8 ? 'good' : 'warn', value: `متوسط ${tags.avg} · أكثر من 10 في ${tags.over10Pct}٪`, benchmark: '3–5 هاشتاغات دقيقة (إرشاد إنستغرام)' });
    igChecks.push({ id: 'ig_hashtag_repeat', label: 'تكرار نفس مجموعة الهاشتاغات', status: feed.length >= 5 ? band(tags.sameSetPct, 30, 60, false) : 'na', value: `${tags.sameSetPct}٪ من المنشورات`, benchmark: '< 30٪ — التكرار الحرفي يُقرأ كسلوك آلي' });
    const caps = captionStats(feed.map((j) => ({ caption: j.advertisement.caption ?? j.advertisement.brief?.caption ?? '', keywords: [j.advertisement.product.titleAr, j.advertisement.product.titleEn, j.advertisement.product.category.nameAr, j.advertisement.product.category.nameEn] })));
    igChecks.push({ id: 'ig_hook', label: 'السطر الأول ضمن أول 125 حرفًا', status: feed.length ? band(caps.hookPct, 80, 50) : 'na', value: `${caps.hookPct}٪`, benchmark: '≥ 80٪ — ما بعده مخفي خلف «المزيد»' });
    igChecks.push({ id: 'ig_keyword', label: 'كلمة بحثية (المنتج/الفئة) في أول الكابشن', status: feed.length ? band(caps.keywordPct, 70, 40) : 'na', value: `${caps.keywordPct}٪`, benchmark: '≥ 70٪ — بحث إنستغرام يقرأ الكابشن' });
    igChecks.push({ id: 'ig_cta', label: 'دعوة واضحة للطلب', status: feed.length ? band(caps.ctaPct, 80, 50) : 'na', value: `${caps.ctaPct}٪`, benchmark: '≥ 80٪' });
    // the strongest distribution signals: sends + saves per reach, by format (only with real imported metrics)
    const withM = feed.map((j) => ({ f: j.advertisement.format, m: (j.result?.metrics ?? {}) as M })).filter((x) => (x.m.reach ?? 0) > 0);
    if (withM.length) {
      const rate = (xs: typeof withM) => Math.round((xs.reduce((a, x) => a + (x.m.shares ?? 0) + (x.m.saves ?? 0), 0) / Math.max(1, xs.reduce((a, x) => a + (x.m.reach ?? 0), 0))) * 10000) / 10;
      const byF = [...new Set(withM.map((x) => x.f))].map((f) => ({ f, n: withM.filter((x) => x.f === f).length, r: rate(withM.filter((x) => x.f === f)) })).filter((x) => x.n >= 3).sort((a, b) => b.r - a.r);
      const F: Record<string, string> = { REEL_VIDEO: 'ريلز', IMAGE_CAROUSEL: 'كاروسيل', IMAGE_FEED: 'منشور', IMAGE_SQUARE: 'مربع' };
      igChecks.push({ id: 'ig_signals', label: 'المشاركة + الحفظ لكل 1000 وصول', status: rate(withM) > 0 ? 'good' : 'bad', value: `${rate(withM)}‰${byF.length > 1 ? ` · الأفضل: ${F[byF[0].f] ?? byF[0].f} ${byF[0].r}‰` : ''}`, benchmark: 'أقوى إشارتين للتوزيع — تابع الأعلى صيغةً' });
      const visits = withM.reduce((a, x) => a + (x.m.profileVisits ?? 0), 0), follows = withM.reduce((a, x) => a + (x.m.follows ?? 0), 0);
      if (visits) igChecks.push({ id: 'ig_profile_conv', label: 'زيارة الملف ← متابعة', status: 'na', value: `${pct(follows, visits)}٪ (${follows}/${visits})`, benchmark: 'يعكس قوة البايو والهايلايت' });
    } else igChecks.push({ id: 'ig_signals', label: 'مقاييس الأداء', status: 'na', value: 'لا مقاييس مستوردة بعد', benchmark: 'تشخيص النظام ← «استيراد مقاييس الأداء الآن»' });
  }
  card('instagram', 'إنستغرام', ig.length, igChecks);

  // ── Facebook / TikTok / YouTube Shorts / Pinterest / Threads: is the free reach used? ──
  const reelsAll = jobs.filter((j) => j.advertisement.format === 'REEL_VIDEO');
  for (const [net, title, videoOnly] of [['facebook', 'فيسبوك', false], ['tiktok', 'تيك توك', true], ['youtube', 'يوتيوب شورتس', true], ['pinterest', 'بنترست', false], ['threads', 'ثريدز', false]] as const) {
    const lk = linked(net);
    if (!lk.length) continue;
    const posts = on(net).length;
    const base = videoOnly ? reelsAll.filter((j) => lk.some((a) => a.id === j.accountId)) : jobs.filter((j) => lk.some((a) => a.id === j.accountId));
    const covered = pct(base.filter((j) => netsOf(j).includes(net)).length, base.length);
    card(net, title, posts, [
      { id: `${net}_active`, label: 'منشورات خلال 30 يومًا', status: posts ? 'good' : 'bad', value: `${posts}`, benchmark: 'مرتبط بـ Metricool — جمهور إضافي بلا تكلفة توليد' },
      { id: `${net}_coverage`, label: videoOnly ? 'نسبة الريلز المنشورة هنا أيضًا' : 'نسبة منشورات الحسابات المرتبطة المنشورة هنا', status: base.length ? band(covered, 70, 30) : 'na', value: `${covered}٪ (${base.length})`, benchmark: '≥ 70٪ — نفس المحتوى، صيغة مكيّفة' },
    ]);
  }

  // ── Google Business Profile (Maps / local search) ──
  const gbp = on('gmb'), gbpLinked = linked('gmb').length > 0;
  const g7 = gbp.filter((j) => j.scheduledFor >= new Date(now.getTime() - 7 * 86400_000)).length;
  card('google', 'Google (الخرائط والبحث المحلي)', gbp.length, gbpLinked ? [
    { id: 'gbp_weekly', label: 'منشور هذا الأسبوع على الملف التجاري', status: g7 ? 'good' : 'bad', value: `${g7}`, benchmark: '≥ 1 أسبوعيًا — الملف النشط يظهر أعلى في الخرائط' },
    { id: 'gbp_month', label: 'منشورات خلال 30 يومًا', status: band(gbp.length, 4, 2), value: `${gbp.length}`, benchmark: '≥ 4' },
  ] : [{ id: 'gbp_linked', label: 'ربط Google Business Profile', status: 'bad', value: 'غير مربوط', benchmark: 'اربطه في Metricool ثم حدّث الحسابات' }]);

  // ── Search engines (the public product catalogue) ──
  const { seoHealth } = await import('../seo/catalog');
  const seo = await seoHealth().catch(() => null);
  const base = env().PUBLIC_BASE_URL;
  const seoChecks: PlatformCheck[] = [
    { id: 'seo_https', label: 'رابط الموقع العام (HTTPS ونطاق حقيقي)', status: /^https:\/\//.test(base) && !/localhost|127\.0\.0\.1/.test(base) ? 'good' : 'bad', value: base.replace(/^https?:\/\//, ''), benchmark: 'PUBLIC_BASE_URL = https://نطاقك' },
  ];
  if (seo && seo.total) {
    seoChecks.push(
      { id: 'seo_descriptions', label: 'صفحات منتجات بوصف كافٍ (≥ 60 حرفًا)', status: band(pct(seo.withDescription, seo.total), 90, 60), value: `${pct(seo.withDescription, seo.total)}٪ (${seo.withDescription}/${seo.total})`, benchmark: '≥ 90٪ — الصفحات الرقيقة لا تتصدر' },
      { id: 'seo_images', label: 'صفحات منتجات بصورة', status: band(pct(seo.withImage, seo.total), 90, 60), value: `${pct(seo.withImage, seo.total)}٪`, benchmark: '≥ 90٪ — صور Google ومعاينة الروابط' },
      { id: 'seo_prices', label: 'سعر «يبدأ من» (يظهر في نتائج البحث)', status: band(pct(seo.withPrice, seo.total), 70, 30), value: `${pct(seo.withPrice, seo.total)}٪`, benchmark: '≥ 70٪' },
      { id: 'seo_sitemap', label: 'خريطة الموقع وبيانات منظمة (Schema.org)', status: 'good', value: 'sitemap.xml + Product/LocalBusiness', benchmark: `أرسلها مرة في Google Search Console: ${seo.sitemap}` },
    );
  }
  card('seo', 'محركات البحث (Google و Bing)', seo?.total ?? 0, seoChecks);

  // ── advice for what is clearly wrong (ids do not repeat the advisor's: story_only, channels_unused, gbp_not_linked, no_shares) ──
  const find = (k: string, id: string) => cards.find((c) => c.key === k)?.checks.find((c) => c.id === id);
  const bad = (k: string, id: string) => find(k, id)?.status === 'bad';
  if (bad('instagram', 'ig_reels_share')) advice.push({ id: 'ig_reels_share', category: 'growth', severity: 'medium', title: 'الريلز قليلة في إنستغرام', evidence: find('instagram', 'ig_reels_share')!.value, why: 'الريلز تُعرض لغير المتابعين (الاستكشاف والريلز)، والصور تصل غالبًا للمتابعين فقط.', steps: ['اجعل ريلز واحدة على الأقل من كل 2–3 منشورات', 'الحسابات ← خطة النشر: ارفع حصة «فيديو Reel»'], link: '/accounts' });
  if (bad('instagram', 'ig_hashtags') || bad('instagram', 'ig_hashtag_repeat')) advice.push({ id: 'ig_hashtags', category: 'growth', severity: 'low', title: 'هاشتاغات كثيرة أو مكررة حرفيًا', evidence: `${find('instagram', 'ig_hashtags')?.value} · تكرار المجموعة ${find('instagram', 'ig_hashtag_repeat')?.value}`, why: 'إنستغرام يوصي بـ 3–5 هاشتاغات دقيقة؛ المجموعة نفسها في كل منشور تبدو آلية ولا تضيف وصولًا.', steps: ['3–5 هاشتاغات: منتج + مدينة/البحرين + مناسبة', 'نوّع المجموعة حسب المنتج والمناسبة'], link: '/approvals' });
  if (bad('instagram', 'ig_keyword') || bad('instagram', 'ig_hook')) advice.push({ id: 'ig_caption_seo', category: 'growth', severity: 'medium', title: 'الكابشن لا يخدم البحث في إنستغرام', evidence: `كلمة بحثية في البداية ${find('instagram', 'ig_keyword')?.value} · سطر أول قصير ${find('instagram', 'ig_hook')?.value}`, why: 'بحث إنستغرام (وجوجل لمنشورات الحسابات التجارية) يعتمد على كلمات الكابشن، والسطر الأول هو ما يُقرأ قبل «المزيد».', steps: ['ابدأ الكابشن باسم المنتج كما يبحث عنه العميل (مثل: «طباعة أكواب بالاسم في البحرين»)', 'سطر أول قصير ≤ 125 حرفًا ثم التفاصيل'], link: '/approvals' });
  if (bad('instagram', 'ig_cadence')) advice.push({ id: 'ig_cadence', category: 'growth', severity: 'medium', title: 'وتيرة نشر منخفضة أو متقطعة', evidence: find('instagram', 'ig_cadence')!.value, why: 'الانقطاع الطويل يخفض الظهور، والانتظام أهم من الكثرة.', steps: ['الجدول الزمني: 3–5 منشورات أسبوعيًا لكل حساب', 'فعّل النشر الآلي مع الموافقة المسبقة'], link: '/schedule' });
  for (const net of ['tiktok', 'youtube', 'facebook']) if (bad(net, `${net}_coverage`) || bad(net, `${net}_active`)) advice.push({ id: `${net}_coverage`, category: 'growth', severity: 'low', title: `${cards.find((c) => c.key === net)!.title}: مرتبط ولا يُستغل`, evidence: `${find(net, `${net}_coverage`)?.value ?? '0'}`, why: 'نفس الريلز تصل لجمهور جديد بلا تكلفة توليد إضافية.', steps: ['الحسابات ← «القنوات التلقائية»: أضف هذه القناة'], link: '/accounts' });
  if (gbpLinked && bad('google', 'gbp_weekly')) advice.push({ id: 'gbp_weekly', category: 'growth', severity: 'medium', title: 'ملف Google التجاري بلا منشور هذا الأسبوع', evidence: `${gbp.length} منشور خلال 30 يومًا`, why: 'النشاط المنتظم على الملف التجاري يدعم الظهور في الخرائط والبحث المحلي («مطبعة قريبة مني»).', steps: ['أضف Google Business Profile لقنوات حساب واحد على الأقل', 'منشور أسبوعي واحد يكفي (عرض/منتج/مناسبة)'], link: '/accounts' });
  if (bad('seo', 'seo_https')) advice.push({ id: 'seo_base_url', category: 'growth', severity: 'medium', title: 'رابط الموقع العام غير مضبوط لمحركات البحث', evidence: base, why: 'خريطة الموقع وروابط المنتجات تحمل هذا الرابط — رابط محلي أو بلا HTTPS لا يُفهرس.', steps: ['في .env على الخادم: PUBLIC_BASE_URL=https://نطاقك', 'ثم: bash scripts/update.sh'], link: '/diagnostics' });
  if (bad('seo', 'seo_descriptions') || bad('seo', 'seo_images')) advice.push({ id: 'seo_thin_pages', category: 'growth', severity: 'low', title: 'صفحات منتجات ضعيفة لمحركات البحث', evidence: `وصف ${find('seo', 'seo_descriptions')?.value} · صور ${find('seo', 'seo_images')?.value}${seo?.missingDescription.length ? ` · مثل: ${seo.missingDescription.slice(0, 3).map((p) => p.titleAr).join('، ')}` : ''}`, why: 'الصفحة بلا وصف أو صورة لا تظهر في Google ولا في صور Google.', steps: ['المنتجات: اكتب وصفًا من 2–3 جمل (المادة، الاستخدام، المدينة)', 'أضف صورة حقيقية للمنتج'], link: '/products' });

  return { at: now.toISOString(), cards, advice };
}
