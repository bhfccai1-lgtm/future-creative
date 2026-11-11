import { prisma } from '../db';
import { redis } from '../queue/connection';
import { getSettings, secretStatus } from '../settings';
import { env } from '../env';
import { run } from '../video/probe';
import { loadApprovedLogo } from '../brand/logo';

export type Status = 'OK' | 'WARN' | 'FAIL';
export interface Check { id: string; label: string; status: Status; detail: string; action?: string; command?: string }
export const HEARTBEAT_KEY = 'fc:worker:heartbeat';

/**
 * Read-only system & account diagnostics. Secrets are reported as configured / not configured only —
 * values (even partial) are never returned.
 */
export async function runDiagnostics(now = new Date()): Promise<{ at: string; overall: Status; checks: Check[] }> {
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);
  const stale = (min: number) => new Date(now.getTime() - min * 60_000);

  try { await prisma.$queryRaw`SELECT 1`; add({ id: 'db', label: 'قاعدة البيانات', status: 'OK', detail: 'متصلة' }); }
  catch (e) { add({ id: 'db', label: 'قاعدة البيانات', status: 'FAIL', detail: (e as Error).message.slice(0, 120), action: 'تحقق من حاوية postgres' }); return { at: now.toISOString(), overall: 'FAIL', checks }; }

  try {
    const hb = await redis().get(HEARTBEAT_KEY);
    add({ id: 'redis', label: 'Redis (طوابير المهام)', status: 'OK', detail: 'متصل' });
    const age = hb ? (now.getTime() - Number(hb)) / 60_000 : null;
    add({ id: 'worker', label: 'عامل الخلفية (Worker)', status: age !== null && age < 3 ? 'OK' : 'FAIL', detail: age === null ? 'لا توجد نبضة — العامل لا يعمل' : `آخر نبضة قبل ${age.toFixed(1)} دقيقة`, action: age === null || age >= 3 ? 'راجع سجل العامل ثم أعد تشغيله على السيرفر' : undefined, command: age === null || age >= 3 ? 'docker compose logs --tail=50 worker && docker compose up -d worker' : undefined });
  } catch { add({ id: 'redis', label: 'Redis (طوابير المهام)', status: 'FAIL', detail: 'غير متاح', action: 'تحقق من حاوية redis' }); }

  const s = await getSettings();
  add({ id: 'kill_switch', label: 'زر الإيقاف الشامل', status: s.killSwitch ? 'WARN' : 'OK', detail: s.killSwitch ? `مفعّل${s.killSwitchReason ? `: ${s.killSwitchReason}` : ''} — لا يُرسل أي نشر` : 'غير مفعّل' });
  add({ id: 'mode', label: 'وضع النشر', status: 'OK', detail: `${s.publishingMode} · النشر الآلي ${s.autoPublishGlobal ? 'يعمل' : 'متوقف'} · إعادة الإرسال التلقائية بعد الغياب: ${s.publishing.autoResubmitAfterAbsence ? 'مفعّلة' : 'معطلة (قرار المشغّل)'}` });

  const openai = await secretStatus('OPENAI_API_KEY');
  add({ id: 'openai', label: 'مفتاح OpenAI', status: openai.configured ? (s.ai.dryRun ? 'WARN' : 'OK') : 'WARN', detail: openai.configured ? (s.ai.dryRun ? 'مُعدّ لكن وضع التجربة (Dry-run) مفعّل — التصاميم غير قابلة للنشر' : 'مُعدّ — توليد حقيقي') : 'غير مُعدّ — التوليد تجريبي فقط', action: openai.configured ? undefined : 'إعدادات الذكاء الاصطناعي ← مفتاح API' });
  const mc = await secretStatus('METRICOOL_API_TOKEN');
  add({ id: 'metricool', label: 'Metricool', status: mc.configured && s.metricool.lastCheckOk ? 'OK' : mc.configured ? 'WARN' : 'FAIL', detail: !mc.configured ? 'الرمز غير مُعدّ' : `آخر تحقق: ${s.metricool.lastCheckAt ?? '—'} — ${s.metricool.lastCheckMessage ?? ''}`.slice(0, 200), action: mc.configured ? undefined : 'إعدادات الربط ← Metricool' });

  const biz = await prisma.business.findFirst();
  if (biz) {
    try { const l = await loadApprovedLogo(biz.id); add({ id: 'logo', label: 'الشعار الرسمي المعتمد', status: 'OK', detail: `SHA-256 ${l.sha256.slice(0, 16)}…` }); }
    catch (e) { add({ id: 'logo', label: 'الشعار الرسمي المعتمد', status: 'FAIL', detail: (e as Error).message, action: 'إعدادات الهوية ← ارفع الشعار الأصلي واعتمده' }); }
  }

  try { const r = await run(env().FFMPEG_PATH, ['-hide_banner', '-version'], 10_000); add({ id: 'ffmpeg', label: 'FFmpeg (إنتاج الريلز)', status: r.code === 0 ? 'OK' : 'FAIL', detail: r.stdout.split('\n')[0].slice(0, 80) }); }
  catch { add({ id: 'ffmpeg', label: 'FFmpeg (إنتاج الريلز)', status: 'FAIL', detail: 'غير مثبت', action: 'ثبّت ffmpeg في صورة Docker' }); }

  const [accounts, stuck, unknown, overdue, failed24, pending] = await Promise.all([
    prisma.socialAccount.findMany({ include: { connection: true } }),
    prisma.publicationJob.count({ where: { state: 'PUBLISHING', lockedAt: { lt: stale(15) } } }),
    prisma.publicationJob.count({ where: { state: 'UNKNOWN' } }),
    prisma.publicationJob.count({ where: { state: 'SCHEDULED', scheduledFor: { lt: stale(60) } } }),
    prisma.publicationJob.count({ where: { state: 'FAILED', updatedAt: { gte: stale(24 * 60) } } }),
    prisma.approvalRequest.count({ where: { status: 'PENDING' } }),
  ]);
  const connected = accounts.filter((a) => a.connection?.status === 'CONNECTED' && a.connection.canPublish).length;
  const paused = accounts.filter((a) => a.paused);
  add({ id: 'accounts', label: 'الحسابات', status: connected === accounts.length ? 'OK' : 'WARN', detail: `${accounts.length} حساب · ${connected} مرتبط بصلاحية نشر · ${accounts.filter((a) => a.autoPublishEnabled).length} نشر آلي · ${accounts.filter((a) => a.autonomousAuthorized).length} مفوّض ذاتيًا · ${paused.length} موقوف` });
  for (const a of accounts.filter((x) => x.connection && x.connection.status !== 'CONNECTED' && x.connection.status !== 'NOT_CONNECTED')) {
    add({ id: `conn_${a.id}`, label: `ربط ${a.name}`, status: 'FAIL', detail: `${a.connection!.status}${a.connection!.lastError ? `: ${a.connection!.lastError}` : ''}`.slice(0, 200), action: 'أعد الربط في Metricool ثم «فحص كل الحسابات الآن»' });
  }
  add({ id: 'stuck', label: 'مهام نشر عالقة', status: stuck ? 'FAIL' : 'OK', detail: stuck ? `${stuck} مهمة «قيد الإرسال» منذ أكثر من 15 دقيقة` : 'لا يوجد', action: stuck ? 'ستتحول تلقائيًا إلى «غير مؤكد» للمطابقة' : undefined });
  add({ id: 'unknown', label: 'نتائج غير مؤكدة', status: unknown ? 'WARN' : 'OK', detail: `${unknown}`, action: unknown ? 'سجل المنشورات ← تصفية UNKNOWN' : undefined });
  add({ id: 'overdue', label: 'مجدولة لم يُؤكد نشرها', status: overdue ? 'WARN' : 'OK', detail: overdue ? `${overdue} منشور تجاوز موعده بساعة دون تأكيد` : 'لا يوجد' });
  add({ id: 'failed', label: 'فشل خلال 24 ساعة', status: failed24 ? 'WARN' : 'OK', detail: `${failed24}` });
  add({ id: 'approvals', label: 'بانتظار الموافقة', status: 'OK', detail: `${pending}` });
  if (s.n8n.enabled) {
    const [dead, backlog, lastOk] = await Promise.all([
      prisma.webhookDelivery.count({ where: { status: 'DEAD', createdAt: { gte: stale(24 * 60) } } }),
      prisma.webhookDelivery.count({ where: { status: 'PENDING', createdAt: { lt: stale(15) } } }),
      prisma.webhookDelivery.findFirst({ where: { status: 'DELIVERED' }, orderBy: { deliveredAt: 'desc' }, select: { deliveredAt: true } }),
    ]);
    add({ id: 'n8n', label: 'تكامل n8n', status: dead ? 'FAIL' : backlog ? 'WARN' : 'OK', detail: `${dead} حدث فشل نهائيًا (24 ساعة) · ${backlog} متأخر · آخر وصول ناجح: ${lastOk?.deliveredAt ? lastOk.deliveredAt.toISOString().slice(0, 16).replace('T', ' ') : '—'}`, action: dead || backlog ? 'تحقق أن n8n يعمل والـWorkflow مفعّل، ثم «إعادة إرسال الأحداث الفاشلة» من إعدادات الربط' : undefined, command: dead || backlog ? 'docker compose --profile n8n ps && docker compose logs --tail=50 n8n' : undefined });
  }

  const overall: Status = checks.some((c) => c.status === 'FAIL') ? 'FAIL' : checks.some((c) => c.status === 'WARN') ? 'WARN' : 'OK';
  return { at: now.toISOString(), overall, checks };
}

/** Periodic stuck-job detection (in addition to restart recovery): stale PUBLISHING → UNKNOWN for reconciliation. */
export async function sweepStuckJobs(staleMs = 15 * 60_000) {
  const cutoff = new Date(Date.now() - staleMs);
  const stuck = await prisma.publicationJob.findMany({ where: { state: 'PUBLISHING', lockedAt: { lt: cutoff } } });
  for (const j of stuck) {
    const moved = await prisma.publicationJob.updateMany({ where: { id: j.id, state: 'PUBLISHING', lockedAt: j.lockedAt }, data: { state: 'UNKNOWN', lockedBy: null, nextCheckAt: new Date(), lastError: 'submission lease expired (stuck)' } });
    if (moved.count) await prisma.advertisement.updateMany({ where: { id: j.advertisementId, state: 'PUBLISHING' }, data: { state: 'UNKNOWN' } });
  }
  return stuck.length;
}
