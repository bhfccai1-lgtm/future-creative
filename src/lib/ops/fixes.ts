import { audit } from '../audit';
import { AppError } from '../errors';

/**
 * «إصلاح الآن»: the diagnostics advice that the app can fix SAFELY by itself, each one re-checked after it runs.
 * Deliberately NOT automatic (a human decides): UNKNOWN publications (a resend could post twice), approvals,
 * the kill switch, dry-run/API keys, and anything on the host (worker down, migrations → «تحديث الخادم»).
 */
export interface FixResult { ok: boolean; message: string }
export interface FixDef {
  id: string; label: string;
  /** shown in a confirmation dialog before running (changes or deletes data) */
  confirm?: string;
  /** included in «إصلاح كل ما يمكن آليًا» (safe, idempotent, no data loss) */
  safe: boolean;
  run: () => Promise<FixResult>;
}

const verifyMetricool = async (): Promise<FixResult> => {
  const { getAdapter } = await import('../publishing/registry');
  const { updateSettings } = await import('../settings');
  let r: FixResult;
  try { r = await (await getAdapter('metricool')).verify(); } catch (e) { r = { ok: false, message: e instanceof AppError ? e.message : (e as Error).message }; }
  await updateSettings((x) => ({ ...x, metricool: { ...x.metricool, lastCheckAt: new Date().toISOString(), lastCheckOk: r.ok, lastCheckMessage: r.message } }), 'diagnostics');
  return { ok: r.ok, message: r.ok ? `الاتصال بـ Metricool سليم ✓ — ${r.message}` : `ما زال الاتصال يفشل: ${r.message} — أنشئ رمزًا جديدًا في إعدادات الربط` };
};

/** DEAD outbox rows of the last 7 days → PENDING again (the delivery worker picks them up within a minute). */
async function retryDead(match: (event: string) => boolean, what: string): Promise<FixResult> {
  const { prisma } = await import('../db');
  const dead = (await prisma.webhookDelivery.findMany({ where: { status: 'DEAD', createdAt: { gte: new Date(Date.now() - 7 * 86400_000) } }, select: { id: true, event: true } })).filter((d) => match(d.event));
  if (!dead.length) return { ok: true, message: 'لا توجد عمليات فاشلة ✓' };
  const r = await prisma.webhookDelivery.updateMany({ where: { id: { in: dead.map((d) => d.id) }, status: 'DEAD' }, data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null } });
  return { ok: true, message: `أُعيدت ${r.count} ${what} إلى طابور الإرسال — تُرسل خلال دقيقة؛ راجع النتيجة بعد قليل` };
}

const FIXES: FixDef[] = [
  { id: 'metricool_verify', label: 'إعادة فحص اتصال Metricool', safe: true, run: verifyMetricool },
  {
    id: 'metrics_import', label: 'استيراد مقاييس الأداء الآن', safe: true,
    run: async () => {
      const { getAdapter } = await import('../publishing/registry');
      const { importMetrics } = await import('../analytics/import');
      const r = await importMetrics(await getAdapter('metricool'), { minAgeH: 1 }) as Record<string, unknown>;
      const n = typeof r.updated === 'number' ? r.updated : 0;
      if ('skipped' in r) return { ok: false, message: `لم يُنفَّذ الاستيراد: ${String(r.skipped)}` };
      const errs = Array.isArray(r.errors) ? r.errors.length : Number(r.errors) || 0;
      return { ok: errs === 0, message: `حُدّثت مقاييس ${n} من ${Number(r.candidates) || 0} منشور${errs ? ` — ${errs} خطأ (افحص اتصال Metricool)` : ''}` };
    },
  },
  {
    id: 'stuck_jobs', label: 'تحرير مهام النشر العالقة', safe: true,
    run: async () => {
      const { sweepStuckJobs } = await import('./diagnostics');
      const n = await sweepStuckJobs();
      return { ok: true, message: n ? `${n} مهمة عالقة نُقلت إلى «غير مؤكد» للمطابقة الآلية مع المنصة — لا يُعاد الإرسال (منع التكرار)` : 'لا توجد مهام عالقة الآن ✓' };
    },
  },
  {
    id: 'queue_clean', label: 'تنظيف المهام الفاشلة القديمة من الطوابير', safe: true,
    run: async () => {
      const { queue, QUEUE } = await import('../queue/queues');
      let n = 0;
      for (const name of Object.values(QUEUE)) n += (await queue(name).clean(24 * 3600_000, 5000, 'failed')).length;
      return { ok: true, message: `حُذف ${n} سجل مهمة فاشلة أقدم من 24 ساعة (أسبابها محفوظة في سجل النشر)` };
    },
  },
  {
    id: 'n8n_retry', label: 'إعادة إرسال أحداث n8n الفاشلة (7 أيام)', safe: false,
    confirm: 'ستُعاد محاولة إرسال أحداث n8n التي فشلت نهائيًا خلال 7 أيام (تحمل نفس المعرّف، فسير العمل يتعرّف على المكرر). متابعة؟',
    run: async () => retryDead((e) => e !== 'archive.google' && !e.startsWith('backup.'), 'حدث n8n'),
  },
  {
    id: 'drive_retry', label: 'إعادة أرشفة المنشورات الفاشلة على Google Drive', safe: true, // the archive script answers «duplicate» for an ad it already archived — a retry never duplicates
    run: async () => retryDead((e) => e === 'archive.google', 'منشور للأرشفة'),
  },
  {
    id: 'print_reminder', label: 'إرسال تذكير متابعة طلبات الطباعة الآن', safe: true,
    run: async () => {
      const { printFollowUps } = await import('../print/board');
      const r = await printFollowUps();
      return { ok: true, message: r.items ? `أُرسل التذكير (${r.items} بند) إلى الإشعارات وتيليجرام إن كان مربوطًا` : 'لا شيء يحتاج متابعة الآن ✓' };
    },
  },
  {
    id: 'retention', label: 'تحرير مساحة: تنظيف البيانات التشغيلية القديمة', safe: false,
    confirm: 'سيُحذف: الإشعارات المقروءة الأقدم من 90 يومًا، وبصمات المحتوى الأقدم من 400 يوم، وتُفرَّغ الردود الخام لمحاولات النشر الأقدم من 180 يومًا.\nسجلات النشر والتدقيق تبقى كما هي. متابعة؟',
    run: async () => {
      const { applyRetention } = await import('./recovery');
      const r = await applyRetention();
      return { ok: true, message: `حُذف ${r.notifications} إشعار و${r.fingerprints} بصمة، وفُرّغت ${r.attempts} محاولة قديمة` };
    },
  },
];

/** Which fix answers which finding (advisor/analysis advice ids and diagnostics check ids). */
const FOR: Record<string, string> = {
  metricool_check: 'metricool_verify', connections_broken: 'metricool_verify', metricool: 'metricool_verify',
  metrics_missing: 'metrics_import', mc_metrics: 'metrics_import', mc_check: 'metricool_verify', n8n_dead_retry: 'n8n_retry', n8n_dead: 'n8n_retry', n8n: 'n8n_retry',
  drive_archive_retry: 'drive_retry', shop_board: 'print_reminder', stuck: 'stuck_jobs', queue_failed: 'queue_clean',
};

export const fixById = (id: string) => FIXES.find((f) => f.id === id) ?? null;
/** The fix for an advice / check id, without the function (safe to pass to the browser). */
export function fixFor(findingId: string): Omit<FixDef, 'run'> | null {
  const f = FOR[findingId] ? fixById(FOR[findingId]) : null;
  return f ? { id: f.id, label: f.label, confirm: f.confirm, safe: f.safe } : null;
}

export async function runFix(id: string, actor: { sub: string; email: string }): Promise<FixResult> {
  const f = fixById(id);
  if (!f) throw new AppError('UNKNOWN_FIX', 'إصلاح غير معروف', 404);
  let r: FixResult;
  try { r = await f.run(); } catch (e) { r = { ok: false, message: `تعذّر التنفيذ: ${(e as Error).message.slice(0, 200)}` }; }
  await audit({ actorId: actor.sub, actorLabel: actor.email, action: 'diagnostics.fix', targetType: 'system', targetId: id, details: { ok: r.ok, message: r.message.slice(0, 300) } });
  return r;
}

/** «إصلاح كل ما يمكن آليًا»: the safe fixes that answer the current findings, each once. */
export function safeFixesFor(findingIds: string[]): string[] {
  return [...new Set(findingIds.map((x) => FOR[x]).filter((x): x is string => !!x && !!fixById(x)?.safe))];
}
