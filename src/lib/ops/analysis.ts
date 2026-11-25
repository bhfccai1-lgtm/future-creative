import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { prisma } from '../db';
import { QC_FIX, type Advice } from './advisor';

/**
 * Expert analysis layer of the diagnostics page — over REAL data only, no AI call, no cost:
 *  1) trends: last 7 days vs the 7 before, with significance tests (a change is only called real when the data
 *     supports it — small samples say «insufficient» instead of guessing)
 *  2) service levels (SLO): p50/p90 of generation, approval wait and publish delay against explicit targets
 *  3) root causes: Pareto of failure reasons (publishing, AI jobs, quality checks)
 *  4) runtime: queues, memory, load, database migrations, the server update agent
 * Each finding that needs action becomes an Advice (evidence → why → steps).
 */

// ───────────────────────── statistics (pure, unit-tested) ─────────────────────────
/** Two-proportion z-test: a1/n1 (current) vs a2/n2 (previous). null when a sample is too small to judge. */
export function twoPropZ(a1: number, n1: number, a2: number, n2: number, minN = 20): number | null {
  if (n1 < minN || n2 < minN) return null;
  const p = (a1 + a2) / (n1 + n2), se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  return se === 0 ? 0 : (a1 / n1 - a2 / n2) / se;
}
/** Counts in two equal windows (Poisson): z ≈ (c1 − c2) / √(c1 + c2). */
export function poissonZ(c1: number, c2: number, minTotal = 10): number | null {
  return c1 + c2 < minTotal ? null : (c1 - c2) / Math.sqrt(c1 + c2);
}
/** Difference of means (Welch, normal approximation). */
export function meanZ(x: number[], y: number[], minN = 10): number | null {
  if (x.length < minN || y.length < minN) return null;
  const m = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const v = (a: number[], mu: number) => a.reduce((s, t) => s + (t - mu) ** 2, 0) / (a.length - 1);
  const mx = m(x), my = m(y), se = Math.sqrt(v(x, mx) / x.length + v(y, my) / y.length);
  return se === 0 ? 0 : (mx - my) / se;
}
/** Nearest-rank percentile (q in 0–100); null for an empty list. */
export function percentile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((q / 100) * s.length) - 1))];
}
export { errorSignature } from './signature';
import { errorSignature } from './signature';
export interface ParetoItem { key: string; source: string; count: number; share: number; cumulative: number }
/** Pareto: most frequent causes first, with each share and the running total (the «vital few» reach ~80 %). */
export function pareto(items: { key: string; source: string }[], top = 8): ParetoItem[] {
  const m = new Map<string, { source: string; count: number }>();
  for (const i of items) { const k = `${i.source}|${i.key}`; const e = m.get(k) ?? { source: i.source, count: 0 }; e.count++; m.set(k, e); }
  const total = items.length || 1;
  let cum = 0;
  return [...m.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, top).map(([k, v]) => {
    cum += v.count;
    return { key: k.slice(k.indexOf('|') + 1), source: v.source, count: v.count, share: Math.round((v.count / total) * 1000) / 10, cumulative: Math.round((cum / total) * 1000) / 10 };
  });
}

export type Verdict = 'improved' | 'worsened' | 'stable' | 'insufficient';
export interface Trend {
  id: string; label: string; unit: '%' | '' | '$' | 'pts';
  current: number | null; previous: number | null; n: [number, number];
  z: number | null; verdict: Verdict; better: 'up' | 'down';
}
/** |z| ≥ 1.96 → 95 % confidence the change is real. */
export function verdictOf(z: number | null, better: 'up' | 'down'): Verdict {
  if (z === null) return 'insufficient';
  if (Math.abs(z) < 1.96) return 'stable';
  return (z > 0) === (better === 'up') ? 'improved' : 'worsened';
}
const r1 = (x: number) => Math.round(x * 10) / 10;
const rate = (a: number, n: number) => (n ? r1((a / n) * 100) : null);

export interface Slo { id: string; label: string; unit: 'ث' | 'د' | 'س'; n: number; p50: number | null; p90: number | null; target: number; targetOn: 'p50' | 'p90'; ok: boolean | null }
export interface RuntimeInfo {
  memory: { rssMb: number; usedPct: number | null; limitMb: number | null };
  load1PerCpu: number; uptimeH: number;
  queues: { name: string; waiting: number; active: number; delayed: number; failed: number }[] | null;
  migrations: { applied: number; pending: string[]; failed: string[] } | null;
}
export interface AnalysisReport { at: string; trends: Trend[]; slos: Slo[]; causes: ParetoItem[]; causesTotal: number; runtime: RuntimeInfo; advice: Advice[] }

// ───────────────────────── data ─────────────────────────
async function cgroupMemory(): Promise<{ limit: number; used: number } | null> {
  try {
    const [max, cur] = await Promise.all([fs.readFile('/sys/fs/cgroup/memory.max', 'utf8'), fs.readFile('/sys/fs/cgroup/memory.current', 'utf8')]);
    const limit = Number(max.trim()), used = Number(cur.trim());
    return Number.isFinite(limit) && limit > 0 && Number.isFinite(used) ? { limit, used } : null; // «max» (no limit) → NaN → host memory instead
  } catch { return null; }
}
async function queueCounts(): Promise<RuntimeInfo['queues']> {
  try {
    const { queue, QUEUE } = await import('../queue/queues');
    const out = await Promise.race([
      Promise.all(Object.values(QUEUE).map(async (name) => {
        const c = await queue(name).getJobCounts('waiting', 'active', 'delayed', 'failed');
        return { name, waiting: c.waiting ?? 0, active: c.active ?? 0, delayed: c.delayed ?? 0, failed: c.failed ?? 0 };
      })),
      new Promise<null>((r) => setTimeout(() => r(null), 3000)),
    ]);
    return out;
  } catch { return null; }
}
/** Migrations shipped with this version (prisma/migrations) vs the database's own record (_prisma_migrations). */
async function migrationState(dir = path.resolve('prisma/migrations')): Promise<RuntimeInfo['migrations']> {
  try {
    const shipped = (await fs.readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    const rows = await prisma.$queryRaw<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`;
    const done = new Set(rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name));
    const failed = rows.filter((r) => !r.finished_at && !r.rolled_back_at).map((r) => r.migration_name);
    return { applied: done.size, pending: shipped.filter((m) => !done.has(m) && !failed.includes(m)), failed };
  } catch { return null; }
}

export async function runAnalysis(now = new Date()): Promise<AnalysisReport> {
  const D = 86400_000, t0 = new Date(now.getTime() - 7 * D), tPrev = new Date(now.getTime() - 14 * D);
  const win = (d: Date) => (d >= t0 ? 0 : d >= tPrev ? 1 : -1);

  const [ads, approvals, jobs, aiJobs, usage] = await Promise.all([
    prisma.advertisement.findMany({ where: { createdAt: { gte: tPrev } }, select: { createdAt: true, qcPassed: true, qcReport: true, state: true, dryRun: true, errorMessage: true } }),
    prisma.approvalRequest.findMany({ where: { OR: [{ decidedAt: { gte: tPrev } }, { status: 'PENDING' }] }, select: { status: true, createdAt: true, decidedAt: true } }),
    prisma.publicationJob.findMany({ where: { scheduledFor: { gte: tPrev, lte: now } }, select: { state: true, scheduledFor: true, lastError: true, result: { select: { verifiedAt: true, engagementScore: true } } } }),
    prisma.aiGenerationJob.findMany({ where: { createdAt: { gte: tPrev } }, select: { kind: true, status: true, error: true, startedAt: true, finishedAt: true, createdAt: true } }),
    prisma.aiUsage.findMany({ where: { createdAt: { gte: tPrev } }, select: { costUsd: true, createdAt: true } }),
  ]);

  // ── 1) trends ──
  const real = ads.filter((a) => !a.dryRun);
  const by = <T,>(xs: T[], d: (x: T) => Date) => [xs.filter((x) => win(d(x)) === 0), xs.filter((x) => win(d(x)) === 1)] as const;
  const [adC, adP] = by(real, (a) => a.createdAt);
  const decided = approvals.filter((a) => a.decidedAt && a.status !== 'PENDING');
  const [apC, apP] = by(decided, (a) => a.decidedAt!);
  const terminal = jobs.filter((j) => ['PUBLISHED', 'FAILED', 'UNKNOWN'].includes(j.state));
  const [jC, jP] = by(terminal, (j) => j.scheduledFor);
  const okJ = (xs: typeof terminal) => xs.filter((j) => j.state === 'PUBLISHED' && j.result?.verifiedAt).length;
  const eng = (xs: typeof jobs) => xs.map((j) => j.result?.engagementScore).filter((x): x is number => typeof x === 'number');
  const [engC, engP] = by(jobs, (j) => j.scheduledFor).map(eng) as [number[], number[]];
  const [uC, uP] = by(usage, (u) => u.createdAt).map((xs) => xs.reduce((s, u) => s + Number(u.costUsd), 0)) as [number, number];
  const passed = (xs: typeof adC) => xs.filter((a) => a.qcPassed).length;
  const approvedN = (xs: typeof apC) => xs.filter((a) => a.status === 'APPROVED').length;
  const mean = (xs: number[]) => (xs.length ? r1(xs.reduce((s, v) => s + v, 0) / xs.length) : null);
  const trend = (t: Omit<Trend, 'verdict'>): Trend => ({ ...t, verdict: verdictOf(t.z, t.better) });
  const trends: Trend[] = [
    trend({ id: 'designs', label: 'التصاميم المنتجة', unit: '', current: adC.length, previous: adP.length, n: [adC.length, adP.length], z: poissonZ(adC.length, adP.length), better: 'up' }),
    trend({ id: 'qc_pass', label: 'نجاح فحص الجودة', unit: '%', current: rate(passed(adC), adC.length), previous: rate(passed(adP), adP.length), n: [adC.length, adP.length], z: twoPropZ(passed(adC), adC.length, passed(adP), adP.length), better: 'up' }),
    trend({ id: 'approval', label: 'نسبة الموافقة', unit: '%', current: rate(approvedN(apC), apC.length), previous: rate(approvedN(apP), apP.length), n: [apC.length, apP.length], z: twoPropZ(approvedN(apC), apC.length, approvedN(apP), apP.length), better: 'up' }),
    trend({ id: 'publish_ok', label: 'نجاح النشر المؤكد', unit: '%', current: rate(okJ(jC), jC.length), previous: rate(okJ(jP), jP.length), n: [jC.length, jP.length], z: twoPropZ(okJ(jC), jC.length, okJ(jP), jP.length), better: 'up' }),
    trend({ id: 'engagement', label: 'متوسط التفاعل للمنشور', unit: 'pts', current: mean(engC), previous: mean(engP), n: [engC.length, engP.length], z: meanZ(engC, engP), better: 'up' }),
    // spend has no sampling noise to test — reported, judged only by a ≥ 50 % jump on a meaningful amount
    { id: 'ai_spend', label: 'إنفاق الذكاء الاصطناعي', unit: '$', current: Math.round(uC * 100) / 100, previous: Math.round(uP * 100) / 100, n: [usage.length, 0], z: null, better: 'down', verdict: uP >= 1 ? (uC > uP * 1.5 ? 'worsened' : uC < uP * 0.67 ? 'improved' : 'stable') : 'insufficient' },
  ];

  // ── 2) service levels ──
  const secs = (a: Date | null, b: Date | null) => (a && b ? (b.getTime() - a.getTime()) / 1000 : null);
  const gen = aiJobs.filter((j) => j.createdAt >= t0 && j.status === 'SUCCEEDED').map((j) => secs(j.startedAt, j.finishedAt)).filter((x): x is number => x !== null && x >= 0);
  const wait = decided.filter((a) => a.decidedAt! >= t0).map((a) => secs(a.createdAt, a.decidedAt)! / 3600).filter((x) => x >= 0);
  const delay = jobs.filter((j) => j.scheduledFor >= t0 && j.result?.verifiedAt).map((j) => secs(j.scheduledFor, j.result!.verifiedAt!)! / 60).filter((x) => x >= -5);
  const slo = (id: string, label: string, unit: Slo['unit'], xs: number[], target: number, targetOn: Slo['targetOn']): Slo => {
    const p50 = percentile(xs, 50), p90 = percentile(xs, 90), v = targetOn === 'p50' ? p50 : p90;
    const rr = (x: number | null) => (x === null ? null : r1(x));
    return { id, label, unit, n: xs.length, p50: rr(p50), p90: rr(p90), target, targetOn, ok: v === null || xs.length < 5 ? null : v <= target };
  };
  const slos: Slo[] = [
    slo('generation', 'زمن توليد خطوة ذكاء اصطناعي', 'ث', gen, 180, 'p90'),
    slo('approval_wait', 'انتظار الموافقة', 'س', wait, 12, 'p50'),
    slo('publish_delay', 'تأخر النشر عن موعده', 'د', delay, 15, 'p90'),
  ];

  // ── 3) root causes (last 7 days) ──
  const causesRaw: { key: string; source: string }[] = [];
  for (const j of jobs) if (j.scheduledFor >= t0 && ['FAILED', 'UNKNOWN'].includes(j.state)) causesRaw.push({ source: 'النشر', key: errorSignature(j.lastError ?? (j.state === 'UNKNOWN' ? 'نتيجة غير مؤكدة من المنصة' : '')) });
  for (const j of aiJobs) if (j.createdAt >= t0 && j.status === 'FAILED') causesRaw.push({ source: `الذكاء الاصطناعي (${j.kind})`, key: errorSignature(j.error ?? '') });
  for (const a of adC) {
    if (a.state === 'FAILED' && a.errorMessage) causesRaw.push({ source: 'إنتاج التصميم', key: errorSignature(a.errorMessage) });
    const checks = ((a.qcReport ?? {}) as { checks?: { id: string; passed: boolean; severity?: string }[] }).checks ?? [];
    for (const c of checks) if (!c.passed && c.severity === 'BLOCKER' && c.id !== 'real_ai_media') causesRaw.push({ source: 'فحص الجودة', key: QC_FIX[c.id]?.title ?? c.id });
  }
  const causes = pareto(causesRaw);

  // ── 4) runtime ──
  const cg = await cgroupMemory();
  const rssMb = Math.round(process.memoryUsage().rss / 1048576);
  const runtime: RuntimeInfo = {
    memory: cg ? { rssMb, usedPct: r1((cg.used / cg.limit) * 100), limitMb: Math.round(cg.limit / 1048576) } : { rssMb, usedPct: r1((1 - os.freemem() / os.totalmem()) * 100), limitMb: Math.round(os.totalmem() / 1048576) },
    load1PerCpu: Math.round((os.loadavg()[0] / Math.max(1, os.cpus().length)) * 100) / 100,
    uptimeH: r1(process.uptime() / 3600),
    queues: await queueCounts(),
    migrations: await migrationState(),
  };

  // ── advice from the analysis ──
  const advice: Advice[] = [];
  const m = runtime.migrations;
  if (m && (m.pending.length || m.failed.length)) advice.push({ id: 'migrations', category: 'reliability', severity: 'critical', title: m.failed.length ? 'تحديث قاعدة بيانات فشل في منتصفه' : 'تحديثات قاعدة بيانات لم تُطبَّق',
    evidence: `${m.failed.length ? `فاشل: ${m.failed.join('، ')}. ` : ''}${m.pending.length ? `معلّق: ${m.pending.join('، ')}` : ''}`,
    why: 'الكود الجديد يتوقع جداول/أعمدة غير موجودة بعد — قد يفشل تسجيل الدخول أو الإنتاج أو النشر.', steps: ['على الخادم: cd /opt/future-creative && bash scripts/update.sh', 'إن تكرر الفشل: docker compose logs migrate --tail 40 وأرسل النتيجة للدعم'], link: '/diagnostics' });
  for (const t of trends) if (t.verdict === 'worsened' && t.id !== 'designs') advice.push({ id: `trend_${t.id}`, category: t.id === 'ai_spend' ? 'cost' : t.id === 'engagement' ? 'growth' : 'reliability', severity: t.id === 'publish_ok' ? 'high' : 'medium',
    title: `تراجع حقيقي في «${t.label}» هذا الأسبوع`, evidence: `${t.previous}${t.unit === '%' ? '٪' : ''} ← ${t.current}${t.unit === '%' ? '٪' : ''} (العينة ${t.n[0]} مقابل ${t.n[1]}${t.z !== null ? `، z = ${t.z.toFixed(2)}` : ''})`,
    why: t.z !== null ? 'الفرق أكبر من التذبذب العشوائي بثقة 95٪ — ليس صدفة.' : 'زيادة كبيرة عن الأسبوع السابق.', steps: causes.length ? [`ابدأ بأكثر الأسباب تكرارًا: «${causes[0].key}» (${causes[0].share}٪ من الأعطال)`, 'راجع جدول الأسباب الجذرية أدناه'] : ['راجع جدول الأسباب الجذرية أدناه'], link: '/diagnostics' });
  for (const s of slos) if (s.ok === false) advice.push({ id: `slo_${s.id}`, category: s.id === 'approval_wait' ? 'publishing' : 'reliability', severity: 'medium', title: `«${s.label}» أبطأ من الهدف`,
    evidence: `${s.targetOn === 'p50' ? 'الوسيط' : '90٪ من الحالات'} ${s.targetOn === 'p50' ? s.p50 : s.p90} ${s.unit} والهدف ≤ ${s.target} ${s.unit} (عينة ${s.n})`,
    why: s.id === 'approval_wait' ? 'التصاميم تنتظر طويلًا فتفوت أفضل أوقات النشر.' : s.id === 'publish_delay' ? 'النشر المتأخر يفوّت ذروة الجمهور.' : 'البطء يؤخر الإنتاج ويرفع احتمال انتهاء المهلة.',
    steps: s.id === 'approval_wait' ? ['خصص وقتًا يوميًا ثابتًا للموافقات', 'فعّل إشعارات الموافقة على الهاتف'] : s.id === 'publish_delay' ? ['تأكد أن عامل الخلفية يعمل (فحص Worker أعلاه)', 'راجع اتصال Metricool'] : ['راجع حالة مزود الذكاء الاصطناعي', 'قلّل عدد المشاهد في الريلز الاحترافي'], link: s.id === 'approval_wait' ? '/approvals' : '/diagnostics' });
  const backlog = runtime.queues?.reduce((a, q) => a + q.waiting, 0) ?? 0, qFailed = runtime.queues?.reduce((a, q) => a + q.failed, 0) ?? 0;
  if (backlog > 50) advice.push({ id: 'queue_backlog', category: 'reliability', severity: 'high', title: 'تراكم مهام في الطوابير', evidence: `${backlog} مهمة تنتظر`, why: 'العامل لا يواكب الحمل أو متوقف.', steps: ['تحقق من فحص Worker', 'على الخادم: docker compose restart worker'], link: '/diagnostics' });
  if (runtime.memory.usedPct !== null && runtime.memory.usedPct > 90) advice.push({ id: 'memory_high', category: 'reliability', severity: 'high', title: 'الذاكرة شبه ممتلئة', evidence: `${runtime.memory.usedPct}٪ من ${runtime.memory.limitMb} MB`, why: 'إنتاج الريلز قد يتوقف فجأة (نفاد الذاكرة).', steps: ['على الخادم: bash scripts/swap.sh (ذاكرة احتياطية)', 'أو ترقية خطة الخادم'], link: '/diagnostics' });
  if (runtime.load1PerCpu > 1.5) advice.push({ id: 'cpu_load', category: 'reliability', severity: 'medium', title: 'حمل المعالج مرتفع', evidence: `${runtime.load1PerCpu} لكل نواة (آخر دقيقة)`, why: 'الإنتاج والواجهة يبطئان.', steps: ['خفّف عدد الريلز الاحترافية المتزامنة', 'راقب الحمل بعد ساعة؛ إن استمر فرقِّ الخادم'], link: '/diagnostics' });
  if (qFailed > 20) advice.push({ id: 'queue_failed', category: 'reliability', severity: 'low', title: 'مهام فاشلة متراكمة في الطوابير', evidence: `${qFailed} مهمة`, why: 'تدل على أعطال متكررة؛ تفاصيلها في جدول الأسباب.', steps: ['راجع جدول الأسباب الجذرية'], link: '/diagnostics' });

  return { at: now.toISOString(), trends, slos, causes, causesTotal: causesRaw.length, runtime, advice };
}

/** Plain-text support report (Arabic) — what the owner copies and sends; no secrets, no personal data. */
export function supportReport(a: AnalysisReport, extra: { version: string; overall: string; failedChecks: string[]; score: number }): string {
  const f = (x: number | null, u = '') => (x === null ? '—' : `${x}${u}`);
  const VERD: Record<Verdict, string> = { improved: '↑ تحسن', worsened: '↓ تراجع', stable: '= ثابت', insufficient: '· عينة صغيرة' };
  const L = [
    `تقرير تشخيص — ${a.at}`, `الإصدار: ${extra.version} · الفحص الفني: ${extra.overall} · درجة الصحة: ${extra.score}/100`,
    extra.failedChecks.length ? `فحوص غير سليمة: ${extra.failedChecks.join(' | ')}` : 'كل الفحوص الفنية سليمة',
    '', '— الاتجاهات (7 أيام مقابل 7 سابقة):', ...a.trends.map((t) => `  ${t.label}: ${f(t.previous)} → ${f(t.current)} ${VERD[t.verdict]}${t.z !== null ? ` (z=${t.z.toFixed(2)})` : ''}`),
    '', '— مستويات الخدمة:', ...a.slos.map((s) => `  ${s.label}: p50 ${f(s.p50)} / p90 ${f(s.p90)} ${s.unit} (هدف ${s.targetOn} ≤ ${s.target}) ${s.ok === null ? '·' : s.ok ? '✓' : '✗'} n=${s.n}`),
    '', `— أهم أسباب الأعطال (${a.causesTotal}):`, ...(a.causes.length ? a.causes.map((c) => `  ${c.share}٪ [${c.source}] ${c.key}`) : ['  لا أعطال']),
    '', '— التشغيل:', `  الذاكرة ${f(a.runtime.memory.usedPct, '٪')} من ${f(a.runtime.memory.limitMb)} MB · الحمل ${a.runtime.load1PerCpu}/نواة · تشغيل ${a.runtime.uptimeH} س`,
    `  الطوابير: ${a.runtime.queues ? a.runtime.queues.map((q) => `${q.name} ${q.waiting}/${q.active}/${q.failed}`).join(' · ') : 'غير متاحة'}`,
    `  قاعدة البيانات: ${a.runtime.migrations ? `${a.runtime.migrations.applied} تحديث مطبّق${a.runtime.migrations.pending.length ? ` · معلّق: ${a.runtime.migrations.pending.join('، ')}` : ''}${a.runtime.migrations.failed.length ? ` · فاشل: ${a.runtime.migrations.failed.join('، ')}` : ''}` : 'تعذّر القراءة'}`,
  ];
  return L.join('\n');
}
