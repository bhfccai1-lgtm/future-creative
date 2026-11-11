import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { redis } from '../queue/connection';
import { getSettings, secretStatus } from '../settings';
import { env } from '../env';
import { monthToDateSpend } from '../ai/cost';
import { startOfMonthInTz } from '../time';
import { analyse, loadSamples, labelOf } from '../analytics/insights';
import { HEARTBEAT_KEY } from './diagnostics';

/**
 * Professional advisor: deterministic rules over REAL system data (no AI call, no cost). Every advice carries the
 * evidence it was derived from, why it matters, concrete steps and where to act. Nothing is estimated or invented:
 * when data is missing the advisor says so instead of guessing.
 */
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type Category = 'reliability' | 'publishing' | 'content' | 'growth' | 'cost' | 'security' | 'integration';
export interface Advice {
  id: string; category: Category; severity: Severity; title: string;
  evidence: string; why: string; steps: string[]; link?: string;
}
export interface Kpis {
  designs7d: number; qcPassRate: number | null; approvalRate: number | null; publishSuccessRate: number | null;
  verifiedPublished7d: number; pendingApprovals: number; avgEngagement30d: number | null;
  aiSpend7d: number; costPerDesign: number | null; costPerVerifiedPost: number | null;
  monthSpend: number; monthBudget: number; projectedMonthSpend: number;
}
export interface AdvisorReport { at: string; score: number; grade: 'A' | 'B' | 'C' | 'D' | 'F'; counts: Record<Severity, number>; kpis: Kpis; advice: Advice[] }

export const CATEGORY_AR: Record<Category, string> = { reliability: 'الموثوقية والتشغيل', publishing: 'النشر', content: 'جودة المحتوى', growth: 'النمو والتحليلات', cost: 'التكلفة', security: 'الأمان والإعدادات', integration: 'التكاملات' };
export const SEVERITY_AR: Record<Severity, string> = { critical: 'حرج', high: 'مرتفع', medium: 'متوسط', low: 'منخفض', info: 'معلومة' };
const WEIGHT: Record<Severity, number> = { critical: 25, high: 10, medium: 4, low: 1, info: 0 };
const ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

/** What to do when a given QC check keeps failing. */
export const QC_FIX: Record<string, { title: string; steps: string[]; link: string }> = {
  logo_present: { title: 'الشعار لا يظهر في التصاميم', steps: ['افتح إعدادات الهوية وتأكد من وجود شعار معتمد بخلفية شفافة', 'أعد توليد التصاميم الفاشلة'], link: '/settings/brand' },
  logo_fingerprint: { title: 'بصمة الشعار تغيّرت', steps: ['اعتمد الشعار الأصلي مرة واحدة فقط ولا تستبدله', 'أعد توليد التصاميم التي أُنتجت قبل التغيير'], link: '/settings/brand' },
  phones: { title: 'أرقام الفروع لا تظهر كاملة', steps: ['راجع أرقام سار وسلماباد في بيانات النشاط', 'إذا تكرر مع لغة معيّنة فأبلغ المطوّر (مساحة النص)'], link: '/settings/brand' },
  no_wrong_numbers: { title: 'ظهور أرقام غير معتمدة في النص', steps: ['تجنب كتابة أرقام هواتف في «فكرة الإعلان»', 'النظام يضيف الأرقام الصحيحة تلقائيًا'], link: '/create' },
  proofread: { title: 'أخطاء شكلية في النصوص', steps: ['راجع النصوص في طابور الموافقات قبل الاعتماد', 'استخدم «طلب تعديل» مع الكلمة الصحيحة'], link: '/approvals' },
  claims: { title: 'ادعاءات أو أسعار غير موثقة', steps: ['لا تكتب أسعارًا أو خصومات أو مدد تسليم في الأفكار والرسائل المعتمدة للمنتجات', 'راجع «الرسائل الموصى بها» في صفحة المنتجات'], link: '/products' },
  product_allowed: { title: 'منتج غير مسموح للحساب', steps: ['حدّث قائمة المنتجات المسموحة في إعدادات الحساب'], link: '/accounts' },
  image_dimensions: { title: 'أبعاد صورة غير صحيحة', steps: ['خلل تقني في التركيب — أرسل معرّف التصميم للمطوّر'], link: '/diagnostics' },
  image_format: { title: 'صيغة صورة غير صحيحة', steps: ['خلل تقني — أرسل معرّف التصميم للمطوّر'], link: '/diagnostics' },
  video_valid: { title: 'فيديوهات ريلز غير صالحة', steps: ['تأكد من سلامة FFmpeg في تشخيص النظام', 'تحقق من ذاكرة ومساحة السيرفر', 'جرّب مدة أقصر للريلز'], link: '/diagnostics' },
  duplicates: { title: 'تكرار الأفكار يمنع النشر', steps: ['وسّع المنتجات المسموحة للحساب', 'نوّع المناسبات والزوايا أو اكتب أفكارًا جديدة', 'استخدم «اقترح أفكارًا» في صفحة الإنشاء'], link: '/create' },
  carousel_slides: { title: 'نصوص الكاروسيل لا تتسع', steps: ['اختصر الأفكار المكتوبة يدويًا للكاروسيل', 'جرّب لغة الحساب الأساسية'], link: '/create' },
  caption_quality: { title: 'نصوص المنشورات طويلة أو بلا دعوة واضحة', steps: ['اترك النص قصيرًا: سطر افتتاحي ثم 3–5 أسطر ثم دعوة', 'استخدم «طلب تعديل» لاختصار النص قبل الاعتماد'], link: '/approvals' },
  ai_text_review: { title: 'التصميم الكامل بالذكاء الاصطناعي يحتاج مراجعة', steps: ['راجع النص المرسوم بعينك قبل الاعتماد', 'استخدم الوضع الطبقي (الافتراضي) للنصوص المضمونة 100%'], link: '/approvals' },
  ai_video: { title: 'فيديو Gemini Veo يفشل ويُستبدل بـ FFmpeg', steps: ['اضغط «فحص المفتاح والنموذج» في إعدادات Gemini', 'تحقق من الفوترة والحصة في Google AI Studio', 'راجع سبب الفشل في فحص الجودة للتصميم'], link: '/settings/ai' },
  real_ai_media: { title: 'تصاميم تجريبية (Dry-run) لا يمكن نشرها', steps: ['أضف مفتاح OpenAI وأوقف وضع التجربة في إعدادات الذكاء الاصطناعي'], link: '/settings/ai' },
};

/** statfs needs an existing path: walk up to the nearest existing parent (media folder may not exist yet). */
export async function existingDir(p: string) {
  const path = await import('node:path'); const fs = await import('node:fs/promises');
  let cur = path.resolve(p);
  for (let i = 0; i < 20; i++) { try { await fs.access(cur); return cur; } catch { const up = path.dirname(cur); if (up === cur) break; cur = up; } }
  return process.cwd();
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

export async function runAdvisor(now = new Date()): Promise<AdvisorReport> {
  const s = await getSettings();
  const ago = (days: number) => new Date(now.getTime() - days * 86400_000);
  const advice: Advice[] = [];
  const add = (a: Advice) => advice.push(a);

  // ───────── data ─────────
  const [accounts, ads14, decided7, approved7, jobs14, verified7, pending, oldestPending, results30, spend7, unknown, failedReasons, hb] = await Promise.all([
    prisma.socialAccount.findMany({ include: { connection: true } }),
    prisma.advertisement.findMany({ where: { createdAt: { gte: ago(14) } }, select: { id: true, accountId: true, productId: true, format: true, state: true, qcPassed: true, qcReport: true, dryRun: true, createdAt: true } }),
    prisma.approvalRequest.count({ where: { decidedAt: { gte: ago(7) }, status: { in: ['APPROVED', 'REJECTED'] } } }),
    prisma.approvalRequest.count({ where: { decidedAt: { gte: ago(7) }, status: 'APPROVED' } }),
    prisma.publicationJob.groupBy({ by: ['state'], _count: true, where: { scheduledFor: { gte: ago(14), lte: now } } }),
    prisma.publicationResult.count({ where: { verifiedAt: { gte: ago(7) } } }),
    prisma.approvalRequest.count({ where: { status: 'PENDING' } }),
    prisma.approvalRequest.findFirst({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    prisma.publicationResult.findMany({ where: { verifiedAt: { gte: ago(30) } }, select: { engagementScore: true, metrics: true, metricsSource: true } }),
    prisma.aiUsage.aggregate({ _sum: { costUsd: true }, where: { createdAt: { gte: ago(7) } } }),
    prisma.publicationJob.count({ where: { state: 'UNKNOWN' } }),
    prisma.publicationJob.groupBy({ by: ['lastError'], _count: true, where: { state: 'FAILED', updatedAt: { gte: ago(7) } }, orderBy: { _count: { lastError: 'desc' } }, take: 3 }),
    redis().get(HEARTBEAT_KEY).catch(() => null),
  ]);
  const ads7 = ads14.filter((a) => a.createdAt >= ago(7));
  const generated7 = ads7.filter((a) => a.state !== 'GENERATING' && a.state !== 'DRAFT');
  const jobCount = (st: string) => jobs14.find((j) => j.state === st)?._count ?? 0;
  const published14 = jobCount('PUBLISHED'), failed14 = jobCount('FAILED'), unknown14 = jobCount('UNKNOWN');
  const monthSpend = await monthToDateSpend(now);
  const dayOfMonth = Math.max(1, Math.ceil((now.getTime() - startOfMonthInTz(now).getTime()) / 86400_000));
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const scored = results30.filter((r) => r.engagementScore !== null);
  const spend7Usd = Number(spend7._sum.costUsd ?? 0);
  const kpis: Kpis = {
    designs7d: ads7.length,
    qcPassRate: pct(generated7.filter((a) => a.qcPassed).length, generated7.length),
    approvalRate: pct(approved7, decided7),
    publishSuccessRate: pct(published14, published14 + failed14 + unknown14),
    verifiedPublished7d: verified7, pendingApprovals: pending,
    avgEngagement30d: scored.length ? Math.round((scored.reduce((a, r) => a + r.engagementScore!, 0) / scored.length) * 100) / 100 : null,
    aiSpend7d: Math.round(spend7Usd * 100) / 100,
    costPerDesign: ads7.length ? Math.round((spend7Usd / ads7.length) * 1000) / 1000 : null,
    costPerVerifiedPost: verified7 ? Math.round((spend7Usd / verified7) * 100) / 100 : null,
    monthSpend: Math.round(monthSpend * 100) / 100, monthBudget: s.ai.monthlyBudgetUsd,
    projectedMonthSpend: Math.round((monthSpend / dayOfMonth) * daysInMonth * 100) / 100,
  };

  // ───────── reliability ─────────
  const hbAge = hb ? (now.getTime() - Number(hb)) / 60_000 : null;
  if (hbAge === null || hbAge > 3) add({ id: 'worker_down', category: 'reliability', severity: 'critical', title: 'عامل الخلفية لا يعمل — لا توليد ولا نشر ولا مطابقة', evidence: hbAge === null ? 'لا توجد نبضة مسجلة' : `آخر نبضة قبل ${hbAge.toFixed(0)} دقيقة`, why: 'كل المهام المجدولة (الحملات، النشر، المطابقة، التحليلات، n8n) يشغّلها العامل. نفّذ الأوامر على السيرفر داخل /opt/future-creative.', steps: ['docker compose ps', 'docker compose logs --tail=80 worker', 'docker compose up -d worker', 'إن تكرر التوقف فافحص الذاكرة ثم مساحة القرص بالأمرين التاليين:', 'free -h', 'df -h'], link: '/diagnostics' });
  const autoAccounts = accounts.filter((a) => a.autoPublishEnabled && !a.paused);
  const lastJob = await prisma.publicationJob.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
  const activeCampaigns = await prisma.campaign.count({ where: { active: true } });
  if ((s.autoPublishGlobal && autoAccounts.length) || activeCampaigns) {
    const hoursSince = lastJob ? (now.getTime() - lastJob.createdAt.getTime()) / 3600_000 : Infinity;
    if (hoursSince > 24) add({ id: 'publishing_stalled', category: 'publishing', severity: 'high', title: 'النشر متوقف رغم تفعيل الأتمتة', evidence: `آخر مهمة نشر ${lastJob ? `قبل ${Math.round(hoursSince)} ساعة` : 'لم تُنشأ أبدًا'} · ${autoAccounts.length} حساب بنشر آلي · ${activeCampaigns} حملة نشطة`, why: 'الحسابات بلا نشر منتظم تخسر الوصول، والخوارزمية تكافئ الاستمرارية.', steps: ['تحقق أن العامل يعمل (أعلاه)', 'راجع طابور الموافقات: في الوضع اليدوي لا يُنشر شيء بلا اعتماد', 'راجع «الأخطاء والتنبيهات» لأسباب فشل التوليد (ميزانية، مفتاح، شعار)', 'تأكد أن الحسابات مرتبطة بصلاحية نشر'], link: '/schedule' });
  }
  if (unknown) add({ id: 'unknown_jobs', category: 'publishing', severity: 'high', title: 'منشورات بنتيجة غير مؤكدة تنتظر قرارك', evidence: `${unknown} مهمة في حالة UNKNOWN`, why: 'لا يُعاد الإرسال تلقائيًا لتجنب النشر المكرر — القرار للمشغّل.', steps: ['افتح Metricool وتحقق من وجود المنشور في الموعد', 'في سجل المنشورات: «بحث ثم إعادة الإرسال» أو «إلغاء»'], link: '/posts?state=UNKNOWN' });
  const finished = published14 + failed14 + unknown14;
  if (finished >= 5 && failed14 / finished > 0.2) add({ id: 'high_failure_rate', category: 'publishing', severity: 'high', title: 'نسبة فشل النشر مرتفعة', evidence: `${failed14} من ${finished} (${pct(failed14, finished)}%) خلال 14 يومًا · أكثر الأسباب: ${failedReasons.map((f) => `${(f.lastError ?? '—').slice(0, 60)} (${f._count})`).join('؛ ') || '—'}`, why: 'الفشل المتكرر يهدر تكلفة التوليد ويترك فجوات في الجدول.', steps: ['عالج السبب الأكثر تكرارًا أولًا (أعلاه)', 'أخطاء 401/403: أعد ربط الحساب في Metricool', '«قنوات غير متاحة»: اربط الشبكة بالعلامة في Metricool أو أزلها من القنوات'], link: '/posts?state=FAILED' });

  // disk space on media storage
  try {
    const { statfs } = await import('node:fs/promises');
    const st = await statfs(await existingDir(env().LOCAL_STORAGE_DIR));
    const freePct = (Number(st.bavail) / Number(st.blocks)) * 100;
    const freeGb = (Number(st.bavail) * Number(st.bsize)) / 1e9;
    if (freePct < 10 || freeGb < 5) add({ id: 'disk_low', category: 'reliability', severity: freePct < 5 ? 'critical' : 'high', title: 'مساحة القرص منخفضة', evidence: `المتاح ${freeGb.toFixed(1)} GB (${freePct.toFixed(0)}%)`, why: 'امتلاء القرص يوقف قاعدة البيانات وحفظ التصاميم والفيديو.', steps: ['راجع حجم النسخ الاحتياطية واحذف القديم منها:', 'ls -lh backups/', 'احذف صور Docker غير المستخدمة:', 'docker system prune -f', 'إن استمر النقص: فعّل تخزين S3 أو كبّر القرص من لوحة Hetzner'], link: '/diagnostics' });
  } catch { /* storage not local or not mounted — skip */ }

  // ───────── content ─────────
  const failures = new Map<string, number>();
  let withQc = 0;
  for (const a of ads14) {
    const r = a.qcReport as unknown as { checks?: { id: string; passed: boolean; severity: string }[] } | null;
    if (!r?.checks) continue;
    withQc++;
    for (const c of r.checks) if (!c.passed) failures.set(c.id, (failures.get(c.id) ?? 0) + 1);
  }
  const topFails = [...failures.entries()].filter(([id]) => id !== 'real_ai_media').sort((a, b) => b[1] - a[1]).slice(0, 3);
  for (const [id, n] of topFails) {
    const fix = QC_FIX[id];
    if (!fix || n < 2 || n / Math.max(1, withQc) < 0.15) continue;
    add({ id: `qc_${id}`, category: 'content', severity: id === 'caption_quality' || id === 'ai_text_review' ? 'low' : 'medium', title: fix.title, evidence: `فشل «${id}» في ${n} من ${withQc} تصميم (${pct(n, withQc)}%) خلال 14 يومًا`, why: 'إصلاح السبب المتكرر يرفع نسبة التصاميم الجاهزة للنشر ويخفض التكلفة المهدرة.', steps: fix.steps, link: fix.link });
  }
  const dry = ads14.filter((a) => a.dryRun).length;
  const openai = await secretStatus('OPENAI_API_KEY');
  if (dry && (s.ai.dryRun || !openai.configured)) add({ id: 'dry_run', category: 'content', severity: 'high', title: 'التوليد في وضع التجربة — لا شيء قابل للنشر', evidence: `${dry} تصميم تجريبي خلال 14 يومًا · مفتاح OpenAI ${openai.configured ? 'مُعدّ' : 'غير مُعدّ'} · وضع التجربة ${s.ai.dryRun ? 'مفعّل' : 'متوقف'}`, why: 'التصاميم التجريبية تُحجب من النشر دائمًا.', steps: ['أضف مفتاح OpenAI', 'أوقف «وضع التجربة» في إعدادات الذكاء الاصطناعي'], link: '/settings/ai' });
  if (pending >= 10 || (oldestPending && now.getTime() - oldestPending.createdAt.getTime() > 24 * 3600_000)) add({ id: 'approval_backlog', category: 'content', severity: 'medium', title: 'تراكم في طابور الموافقات', evidence: `${pending} تصميم ينتظر${oldestPending ? ` · الأقدم منذ ${Math.round((now.getTime() - oldestPending.createdAt.getTime()) / 3600_000)} ساعة` : ''}`, why: 'التصاميم المتأخرة تفوّت مواعيد الحملات والمناسبات.', steps: ['خصص وقتًا يوميًا للمراجعة أو اعتمد من تيليجرام (n8n)', 'للحسابات الموثوقة: فكّر بالتفويض الذاتي بعد مراجعة النتائج'], link: '/approvals' });
  if (decided7 >= 5 && approved7 / decided7 < 0.6) add({ id: 'low_approval', category: 'content', severity: 'medium', title: 'نسبة رفض التصاميم مرتفعة', evidence: `اعتُمد ${approved7} من ${decided7} (${pct(approved7, decided7)}%) خلال 7 أيام`, why: 'الرفض المتكرر يعني أن التوجيه الإبداعي لا يطابق ذوقك — وكل رفض تكلفة.', steps: ['اكتب سبب الرفض دائمًا (يُستخدم لتحسين التوليد)', 'استخدم «طلب تعديل» بدل الرفض عند ملاحظات بسيطة', 'ثبّت أسلوب تصميم وقالبًا مفضلين للحساب'], link: '/approvals' });
  // product repetition per account
  for (const a of accounts) {
    const mine = ads14.filter((x) => x.accountId === a.id);
    if (mine.length < 6) continue;
    const top = Math.max(...Object.values(mine.reduce<Record<string, number>>((m, x) => ({ ...m, [x.productId]: (m[x.productId] ?? 0) + 1 }), {})));
    if (top / mine.length > 0.5) add({ id: `repetition_${a.id}`, category: 'content', severity: 'low', title: `تكرار نفس المنتج في ${a.name}`, evidence: `منتج واحد في ${top} من ${mine.length} تصميم (14 يومًا)`, why: 'التنويع يجذب شرائح جديدة ويقلل ملل المتابعين.', steps: ['أضف منتجات مسموحة أكثر للحساب', 'أو أنشئ حملة لمنتج آخر'], link: `/accounts/${a.id}` });
  }

  // ───────── growth ─────────
  const fixedStory = accounts.filter((a) => a.formatStrategy !== 'GROWTH_MIX' && a.publishFormat === 'IMAGE_STORY' && a.autoPublishEnabled);
  if (fixedStory.length) add({ id: 'story_only', category: 'growth', severity: 'medium', title: 'حسابات تنشر ستوري فقط', evidence: `${fixedStory.length} حساب: ${fixedStory.slice(0, 5).map((a) => a.name).join('، ')}`, why: 'بيانات حساباتك: الريلز وصلت 4–6 أضعاف المتابعين، والستوري لا تجلب متابعين جددًا.', steps: ['في إعدادات كل حساب: «استراتيجية المحتوى» = مزيج النمو (50% ريلز · 25% كاروسيل)'], link: '/accounts' });
  const noMetrics = results30.filter((r) => r.engagementScore === null).length;
  if (results30.length >= 3 && noMetrics / results30.length > 0.5) add({ id: 'metrics_missing', category: 'growth', severity: 'medium', title: 'منشورات مؤكدة بلا مقاييس أداء', evidence: `${noMetrics} من ${results30.length} منشور (30 يومًا) بلا مقاييس`, why: 'بدون مقاييس لا يمكن معرفة ما ينجح، ولا يتعلم اختيار المنتجات.', steps: ['اضغط «استيراد مقاييس Metricool الآن» في التقارير', 'إن فشل الاستيراد: تحقق أن خطة Metricool تتيح التحليلات عبر API'], link: '/reports' });
  const skips = results30.map((r) => Number((r.metrics as Prisma.JsonObject | null)?.skipRatePct)).filter(Number.isFinite);
  if (skips.length >= 3) {
    const avg = skips.reduce((a, b) => a + b, 0) / skips.length;
    if (avg > 60) add({ id: 'reel_hook', category: 'growth', severity: 'medium', title: 'افتتاحية الريلز ضعيفة', evidence: `متوسط التخطي ${avg.toFixed(0)}% في أول 3 ثوانٍ (${skips.length} ريلز)`, why: 'كل مشاهد يتخطى مبكرًا يقلل توزيع إنستغرام للريلز.', steps: ['الافتتاحية القوية مفعّلة افتراضيًا — تأكد أن السيرفر محدّث', 'اختصر الريلز إلى 7–10 ثوانٍ', 'جرّب Gemini Veo لحركة حقيقية من الثانية الأولى'], link: '/reports' });
  }
  const sharesSaves = results30.reduce((a, r) => { const m = (r.metrics ?? {}) as Record<string, number>; return a + (Number(m.shares) || 0) + (Number(m.saves) || 0); }, 0);
  if (scored.length >= 5 && sharesSaves === 0) add({ id: 'no_shares', category: 'growth', severity: 'medium', title: 'صفر حفظ ومشاركة', evidence: `${scored.length} منشور بمقاييس خلال 30 يومًا بلا حفظ أو مشاركة`, why: 'الحفظ والإرسال لصديق أقوى إشارات التوزيع لغير المتابعين.', steps: ['أضف الكاروسيل التعليمي إلى مزيج المحتوى', 'اطلب «أرسله لمن يستاهل» في النص بدل الأسئلة العامة'], link: '/create' });
  try {
    const an = analyse(await loadSamples({ since: ago(90) }));
    for (const i of an.insights.filter((x) => x.confidence === 'CONFIRMED').slice(0, 2)) add({ id: `confirmed_${i.dimension}`, category: 'growth', severity: 'info', title: `نمط مؤكد: ${i.dimensionAr} — «${labelOf(i.dimension, i.best.value)}»`, evidence: i.note, why: 'نتيجة دالة إحصائيًا على بياناتك (مبدئية — تُراجع دوريًا).', steps: ['زِد نسبة هذا الخيار في الحملات ومزيج المحتوى', 'استمر بقياس النتائج أسبوعيًا'], link: '/reports' });
    if (an.total > 0 && an.smallSample) add({ id: 'small_sample', category: 'growth', severity: 'info', title: 'بيانات الأداء ما زالت قليلة', evidence: `${an.total} منشور بمقاييس خلال 90 يومًا`, why: 'الاستنتاجات من عينة صغيرة اتجاهات فقط، لا قرارات نهائية.', steps: ['انشر بانتظام 3–4 أسابيع قبل الحكم على الأنماط'], link: '/reports' });
  } catch { /* analytics optional */ }

  // ───────── cost ─────────
  if (s.ai.monthlyBudgetUsd > 0 && kpis.projectedMonthSpend > s.ai.monthlyBudgetUsd) add({ id: 'budget_projection', category: 'cost', severity: kpis.monthSpend >= s.ai.monthlyBudgetUsd ? 'high' : 'medium', title: 'الإنفاق المتوقع يتجاوز الميزانية الشهرية', evidence: `أُنفق $${kpis.monthSpend} حتى اليوم ${dayOfMonth} · المتوقع $${kpis.projectedMonthSpend} من $${s.ai.monthlyBudgetUsd}`, why: 'عند بلوغ الحد يتوقف التوليد تلقائيًا حتى الشهر التالي.', steps: ['خفّض جودة الصور إلى medium', 'قلّل الريلز الاحترافية متعددة المشاهد وفيديوهات Veo', 'ركّز التوليد على الحسابات الأساسية', 'أو ارفع الميزانية إن كان العائد مبررًا'], link: '/settings/ai' });
  if (kpis.costPerVerifiedPost !== null && kpis.costPerVerifiedPost > 2) add({ id: 'cost_per_post', category: 'cost', severity: 'low', title: 'تكلفة المنشور المؤكد مرتفعة', evidence: `$${kpis.costPerVerifiedPost} لكل منشور مؤكد (7 أيام)`, why: 'تصاميم كثيرة تُولَّد ولا تُنشر (رفض/فشل/تكرار).', steps: ['ارفع نسبة الاعتماد (راجع توصيات المحتوى)', 'عالج أسباب فشل النشر'], link: '/analytics' });

  // ───────── integrations ─────────
  const gemini = await secretStatus('GEMINI_API_KEY');
  if (s.ai.video.engine === 'veo' && !gemini.configured) add({ id: 'veo_no_key', category: 'integration', severity: 'high', title: 'محرك Veo مختار بدون مفتاح Gemini', evidence: 'المحرك الافتراضي للريلز = Gemini Veo · المفتاح غير مُعدّ', why: 'كل ريلز سيسقط إلى FFmpeg مع تنبيه.', steps: ['أضف مفتاح Gemini واضغط «فحص المفتاح والنموذج»', 'أو أعد المحرك الافتراضي إلى FFmpeg'], link: '/settings/ai' });
  const broken = accounts.filter((a) => a.connection && ['EXPIRED', 'INSUFFICIENT_PERMISSIONS', 'ERROR', 'DISCONNECTED'].includes(a.connection.status));
  if (broken.length) add({ id: 'connections_broken', category: 'integration', severity: 'high', title: 'حسابات فقدت الربط مع Metricool', evidence: broken.map((a) => `${a.name} (${a.connection!.status})`).slice(0, 6).join('، '), why: 'لن يُنشر شيء على هذه الحسابات حتى يعود الربط.', steps: ['أعد ربط الشبكة داخل Metricool للعلامة المعنية', 'ثم «فحص كل الحسابات الآن» في إعدادات الربط'], link: '/settings/integrations' });
  if (!s.metricool.lastCheckOk && (await secretStatus('METRICOOL_API_TOKEN')).configured) add({ id: 'metricool_check', category: 'integration', severity: 'medium', title: 'آخر تحقق من Metricool فشل', evidence: s.metricool.lastCheckMessage ?? '—', why: 'قد يعني انتهاء الرمز أو تغيّر الخطة.', steps: ['اضغط «اختبار الاتصال» في إعدادات الربط', 'أنشئ رمزًا جديدًا من Metricool إن لزم'], link: '/settings/integrations' });
  if (s.n8n.enabled) {
    const dead = await prisma.webhookDelivery.count({ where: { status: 'DEAD', createdAt: { gte: ago(1) } } });
    if (dead) add({ id: 'n8n_dead', category: 'integration', severity: 'medium', title: 'أحداث n8n لم تصل', evidence: `${dead} حدث فشل نهائيًا خلال 24 ساعة`, why: 'تفوتك تنبيهات تيليجرام والموافقات.', steps: ['تأكد أن n8n يعمل والـWorkflow مفعّل', '«إعادة إرسال الأحداث الفاشلة» في إعدادات الربط'], link: '/settings/integrations' });
  }

  // ───────── security & configuration ─────────
  const base = env().PUBLIC_BASE_URL;
  if (env().NODE_ENV === 'production' && !base.startsWith('https://')) add({ id: 'no_https', category: 'security', severity: 'high', title: 'رابط الموقع ليس HTTPS', evidence: `PUBLIC_BASE_URL = ${base}`, why: 'روابط الوسائط الموقعة وملفات الكوكيز تتطلب HTTPS، وبعض المنصات ترفض روابط HTTP.', steps: ['في ملف الإعدادات على السيرفر اجعل رابط الموقع يبدأ بـ https (المتغيران DOMAIN و PUBLIC_BASE_URL)', 'docker compose up -d'], link: '/diagnostics' });
  const admins = await prisma.user.count({ where: { active: true, role: { name: 'ADMIN' } } });
  if (admins > 3) add({ id: 'many_admins', category: 'security', severity: 'low', title: 'عدد كبير من المديرين', evidence: `${admins} حسابات بصلاحية مدير`, why: 'مبدأ أقل صلاحية يقلل المخاطر.', steps: ['حوّل من لا يحتاج الإعدادات إلى «محرر»'], link: '/settings/integrations' });
  const autonomous = accounts.filter((a) => a.autonomousAuthorized);
  if (autonomous.length && s.publishingMode === 'AUTONOMOUS') add({ id: 'autonomous_on', category: 'security', severity: 'info', title: 'النشر الذاتي مفعّل', evidence: `${autonomous.length} حساب يُنشر بلا موافقة يدوية`, why: 'مقبول للحسابات الموثوقة — راجع عيّنة أسبوعيًا.', steps: ['راجع آخر 5 منشورات لكل حساب مفوّض أسبوعيًا', 'زر الإيقاف الطارئ متاح لكل حساب'], link: '/accounts' });
  if (s.killSwitch) add({ id: 'kill_switch', category: 'publishing', severity: 'info', title: 'الإيقاف الشامل مفعّل', evidence: s.killSwitchReason ?? 'بدون سبب مسجل', why: 'لا يُرسل أي منشور حتى إلغاؤه.', steps: ['ألغِ الإيقاف من «جدول النشر الآلي» عند الجاهزية'], link: '/schedule' });

  advice.sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));
  const counts = Object.fromEntries(ORDER.map((sv) => [sv, advice.filter((a) => a.severity === sv).length])) as Record<Severity, number>;
  const score = Math.max(0, 100 - advice.reduce((n, a) => n + WEIGHT[a.severity], 0));
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';
  return { at: now.toISOString(), score, grade, counts, kpis, advice };
}

/** Daily snapshot of the health score (last 60 days) for the trend line. */
export async function recordHealthSnapshot(now = new Date()) {
  const r = await runAdvisor(now);
  const key = 'diag:history';
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  const hist = ((row?.value as { date: string; score: number; critical: number; high: number }[] | null) ?? []).filter((h) => h.date !== now.toISOString().slice(0, 10));
  hist.push({ date: now.toISOString().slice(0, 10), score: r.score, critical: r.counts.critical, high: r.counts.high });
  const value = hist.slice(-60) as unknown as Prisma.InputJsonValue;
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  return { score: r.score, grade: r.grade };
}
export async function healthHistory() {
  const row = await prisma.systemSetting.findUnique({ where: { key: 'diag:history' } });
  return ((row?.value as { date: string; score: number; critical: number; high: number }[] | null) ?? []);
}
