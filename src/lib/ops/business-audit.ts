import { prisma } from '../db';
import { getSettings, secretStatus } from '../settings';
import type { Advice } from './advisor';
import { scoreOf, type PlatformCard, type PlatformCheck, type CheckStatus } from './social-audit';

/**
 * Expert audit of the tools and the shop behind the posts: Metricool, n8n, Google Drive (archive + backups) and the
 * print shop itself (orders board, customer follow-ups, sales). Same card format as the platform audit; real rows
 * only. Every problem the app can fix safely has a «إصلاح الآن» (see fixes.ts).
 */
export interface BusinessAudit { at: string; cards: PlatformCard[]; advice: Advice[] }
const H = 3600_000, D = 24 * H;
const pct = (a: number, n: number) => (n ? Math.round((a / n) * 100) : 0);
const band = (v: number, good: number, warn: number): CheckStatus => (v >= good ? 'good' : v >= warn ? 'warn' : 'bad');
const ago = (iso: string | Date | null | undefined, now: Date) => (iso ? Math.round((now.getTime() - new Date(iso).getTime()) / H) : null);
const agoTxt = (h: number | null) => (h === null ? 'أبدًا' : h < 48 ? `قبل ${h} ساعة` : `قبل ${Math.round(h / 24)} يوم`);

export async function runBusinessAudit(now = new Date()): Promise<BusinessAudit> {
  const s = await getSettings();
  const d7 = new Date(now.getTime() - 7 * D), d30 = new Date(now.getTime() - 30 * D);
  const cards: PlatformCard[] = [], advice: Advice[] = [];
  const card = (key: string, title: string, posts: number, checks: PlatformCheck[]) => cards.push({ key, title, posts, checks, score: scoreOf(checks) });

  // ── Metricool ──
  const [token, conns, results30, lastComp] = await Promise.all([
    secretStatus('METRICOOL_API_TOKEN'),
    prisma.socialConnection.findMany({ select: { status: true, account: { select: { name: true } } } }),
    prisma.publicationResult.findMany({ where: { verifiedAt: { gte: d30, lte: new Date(now.getTime() - 24 * H) } }, select: { metricsFetchedAt: true } }),
    prisma.competitorSnapshot.findFirst({ orderBy: { takenAt: 'desc' }, select: { takenAt: true } }),
  ]);
  const okConn = conns.filter((c) => c.status === 'CONNECTED').length, checkAge = ago(s.metricool.lastCheckAt, now);
  const withMetrics = results30.filter((r) => r.metricsFetchedAt).length;
  card('metricool', 'Metricool (النشر والتحليلات)', conns.length, [
    { id: 'mc_token', label: 'رمز الـ API', status: token.configured ? 'good' : 'bad', value: token.configured ? 'مضبوط (مشفّر)' : 'غير مضبوط', benchmark: 'إعدادات الربط ← Metricool' },
    { id: 'mc_check', label: 'آخر فحص اتصال', status: !token.configured ? 'na' : !s.metricool.lastCheckOk ? 'bad' : (checkAge ?? 999) <= 24 ? 'good' : 'warn', value: `${s.metricool.lastCheckOk ? 'ناجح' : 'فاشل'} · ${agoTxt(checkAge)}`, benchmark: 'ناجح خلال 24 ساعة' },
    { id: 'mc_connections', label: 'الحسابات المربوطة', status: conns.length ? band(pct(okConn, conns.length), 100, 70) : 'na', value: `${okConn}/${conns.length}${conns.length - okConn ? ` · منقطع: ${conns.filter((c) => c.status !== 'CONNECTED').slice(0, 3).map((c) => c.account.name).join('، ')}` : ''}`, benchmark: 'كلها CONNECTED' },
    { id: 'mc_metrics', label: 'منشورات مؤكدة لها مقاييس مستوردة', status: results30.length >= 3 ? band(pct(withMetrics, results30.length), 80, 50) : 'na', value: `${pct(withMetrics, results30.length)}٪ (${withMetrics}/${results30.length})`, benchmark: '≥ 80٪ — الاستيراد الليلي يعمل' },
    { id: 'mc_competitors', label: 'بيانات المنافسين', status: lastComp ? band(14 - (ago(lastComp.takenAt, now)! / 24), 0, -16) : 'warn', value: lastComp ? agoTxt(ago(lastComp.takenAt, now)) : 'لم تُستورد', benchmark: 'أحدث من 14 يومًا' },
  ]);

  // ── n8n + Google Drive archive (the same outbox) ──
  const deliveries = await prisma.webhookDelivery.findMany({ where: { createdAt: { gte: d7 } }, select: { event: true, status: true, createdAt: true, lastError: true } });
  const n8n = deliveries.filter((x) => x.event !== 'archive.google' && !x.event.startsWith('backup.')), arc = deliveries.filter((x) => x.event === 'archive.google');
  const rateOf = (xs: typeof deliveries) => { const done = xs.filter((x) => x.status !== 'PENDING'); return { n: done.length, ok: pct(done.filter((x) => x.status === 'DELIVERED').length, done.length), dead: xs.filter((x) => x.status === 'DEAD').length, late: xs.filter((x) => x.status === 'PENDING' && now.getTime() - x.createdAt.getTime() > H).length }; };
  const nr = rateOf(n8n);
  card('n8n', 'n8n (الأتمتة وتيليجرام)', n8n.length, s.n8n.enabled ? [
    { id: 'n8n_url', label: 'رابط الـ Webhook', status: /^https:\/\//.test(s.n8n.webhookUrl) ? 'good' : s.n8n.webhookUrl ? 'warn' : 'bad', value: s.n8n.webhookUrl ? s.n8n.webhookUrl.replace(/^(https?:\/\/[^/]+).*/, '$1/…') : 'فارغ', benchmark: 'HTTPS' },
    { id: 'n8n_delivery', label: 'نجاح تسليم الأحداث (7 أيام)', status: nr.n >= 5 ? band(nr.ok, 98, 90) : 'na', value: `${nr.ok}٪ من ${nr.n}`, benchmark: '≥ 98٪' },
    { id: 'n8n_dead', label: 'أحداث فشلت نهائيًا', status: nr.dead ? 'bad' : 'good', value: `${nr.dead}`, benchmark: '0 — «إصلاح الآن» يعيد إرسالها' },
    { id: 'n8n_backlog', label: 'أحداث متأخرة أكثر من ساعة', status: nr.late ? 'warn' : 'good', value: `${nr.late}`, benchmark: '0 — تأكد أن سير العمل في n8n مفعّل' },
  ] : [{ id: 'n8n_off', label: 'التكامل', status: 'na', value: 'غير مفعّل', benchmark: 'اختياري: تنبيهات تيليجرام وموافقات من الهاتف' }]);

  // ── Google Drive: archive of published posts + database backups ──
  const { SCRIPT_VERSION, driveConfirmed } = await import('../integrations/google-archive');
  const ga = s.googleArchive, ar = rateOf(arc);
  const media = await prisma.mediaAsset.findMany({ where: { createdAt: { gte: d30, lte: new Date(now.getTime() - 6 * H) } }, select: { bytes: true, meta: true }, take: 2000 });
  const onDrive = media.filter((m) => driveConfirmed(m)).length;
  const configured = !!(ga.folderId && ga.sheetId);
  card('drive', 'Google Drive (الأرشيف والنسخ الاحتياطي)', arc.length, configured ? [
    { id: 'drive_test', label: 'آخر اختبار للأرشيف', status: ga.lastTest?.ok ? 'good' : 'bad', value: ga.lastTest ? `${ga.lastTest.ok ? 'ناجح' : 'فاشل'} · ${agoTxt(ago(ga.lastTest.at, now))}${ga.lastTest.folderName ? ` · ${ga.lastTest.folderName}` : ''}` : 'لم يُختبر', benchmark: 'ناجح' },
    { id: 'drive_script', label: 'إصدار سكربت Apps Script', status: ga.lastTest?.version == null ? 'na' : ga.lastTest.version >= SCRIPT_VERSION ? 'good' : 'bad', value: ga.lastTest?.version != null ? `v${ga.lastTest.version}` : '—', benchmark: `v${SCRIPT_VERSION} (انسخ السكربت الجديد عند التحديث)` },
    { id: 'drive_archive', label: 'نجاح أرشفة المنشورات (7 أيام)', status: ar.n >= 3 ? band(ar.ok, 98, 85) : 'na', value: `${ar.ok}٪ من ${ar.n}${ar.dead ? ` · فاشل نهائيًا ${ar.dead}` : ''}`, benchmark: '≥ 98٪' },
    { id: 'drive_media', label: 'وسائط 30 يومًا محفوظة ومؤكدة على Drive', status: media.length >= 5 ? band(pct(onDrive, media.length), 90, 60) : 'na', value: `${pct(onDrive, media.length)}٪ (${onDrive}/${media.length})`, benchmark: '≥ 90٪ (مطابقة الحجم)' },
  ] : [{ id: 'drive_off', label: 'الأرشيف', status: 'warn', value: 'غير مضبوط', benchmark: 'إعدادات الربط ← أرشيف Google — نسخة خارج الخادم من كل منشور' }]);

  // ── the print shop: orders board, customers, sales ──
  const { printBoard } = await import('../print/board');
  const b = await printBoard(null, now);
  const leads = await prisma.lead.findMany({ where: { OR: [{ createdAt: { gte: d30 } }, { status: { in: ['NEW', 'CONTACTED', 'QUOTED'] } }] }, select: { status: true, createdAt: true, firstContactAt: true, nextFollowUpAt: true, valueBhd: true, wonAt: true, closedAt: true } });
  const open = leads.filter((l) => ['NEW', 'CONTACTED', 'QUOTED'].includes(l.status));
  const overdue = open.filter((l) => l.nextFollowUpAt && l.nextFollowUpAt < now).length;
  const unanswered = leads.filter((l) => l.status === 'NEW' && !l.firstContactAt && now.getTime() - l.createdAt.getTime() > 2 * H).length;
  const resp = leads.filter((l) => l.firstContactAt && l.createdAt >= d30).map((l) => (l.firstContactAt!.getTime() - l.createdAt.getTime()) / 60_000).sort((x, y) => x - y);
  const medResp = resp.length ? Math.round(resp[Math.floor((resp.length - 1) / 2)]) : null;
  const closed30 = leads.filter((l) => l.closedAt && l.closedAt >= d30 && ['WON', 'LOST'].includes(l.status));
  const won30 = leads.filter((l) => l.status === 'WON' && l.wonAt && l.wonAt >= d30);
  const revenue = Math.round(won30.reduce((a, l) => a + (l.valueBhd ?? 0), 0) * 1000) / 1000;
  const lateProof = b.awaitingClient.filter((x) => x.days >= 2).length;
  card('printshop', 'إدارة المطبعة (الطلبات والعملاء)', leads.length, [
    { id: 'shop_unanswered', label: 'استفسارات بلا رد منذ أكثر من ساعتين', status: unanswered ? 'bad' : 'good', value: `${unanswered}`, benchmark: '0 — أول رد سريع يضاعف فرص البيع' },
    { id: 'shop_response', label: 'وسيط زمن أول رد (30 يومًا)', status: medResp === null || resp.length < 5 ? 'na' : medResp <= 60 ? 'good' : medResp <= 240 ? 'warn' : 'bad', value: medResp === null ? '—' : medResp < 60 ? `${medResp} دقيقة` : `${Math.round(medResp / 6) / 10} ساعة`, benchmark: '≤ ساعة' },
    { id: 'shop_followups', label: 'متابعات عملاء متأخرة', status: overdue ? (overdue > 5 ? 'bad' : 'warn') : 'good', value: `${overdue} من ${open.length} مفتوح`, benchmark: '0' },
    { id: 'shop_win_rate', label: 'نسبة الإغلاق بالبيع (30 يومًا)', status: closed30.length >= 5 ? band(pct(won30.length, closed30.length), 30, 15) : 'na', value: `${pct(won30.length, closed30.length)}٪ (${won30.length}/${closed30.length}) · ${revenue} د.ب`, benchmark: '≥ 30٪ للطباعة حسب الطلب' },
    { id: 'shop_proofs', label: 'بروفات بانتظار العميل ≥ يومين', status: lateProof ? 'warn' : 'good', value: `${lateProof}${b.changesRequested.length ? ` · طلبات تعديل ${b.changesRequested.length}` : ''}`, benchmark: '0 — ذكّر العميل' },
    { id: 'shop_production', label: 'طلبات متوقفة في الإنتاج / جاهزة لم تُستلم', status: b.stuck.length ? 'bad' : b.readyNotCollected.length ? 'warn' : 'good', value: `${b.stuck.length} متوقف · ${b.readyNotCollected.length} جاهز · ${b.needFiles.length} بلا ملفات`, benchmark: '0 — يومان كحد أقصى في كل مرحلة' },
  ]);

  // ── advice (with a «إصلاح الآن» where fixes.ts has one) ──
  const chk = (k: string, id: string) => cards.find((c) => c.key === k)?.checks.find((c) => c.id === id);
  const isBad = (k: string, id: string) => chk(k, id)?.status === 'bad';
  if (isBad('metricool', 'mc_metrics')) advice.push({ id: 'metrics_missing', category: 'growth', severity: 'medium', title: 'مقاييس الأداء لا تُستورد من Metricool', evidence: chk('metricool', 'mc_metrics')!.value, why: 'بدون مقاييس لا يتعلم النظام أي محتوى ينجح ولا تعمل التوصيات.', steps: ['«إصلاح الآن» يستورد المقاييس فورًا', 'إن بقيت ناقصة: افحص اتصال Metricool'], link: '/analytics' });
  if (isBad('n8n', 'n8n_dead')) advice.push({ id: 'n8n_dead_retry', category: 'integration', severity: 'medium', title: 'أحداث n8n فشلت نهائيًا', evidence: `${nr.dead} حدث خلال 7 أيام`, why: 'تفوتك تنبيهات تيليجرام والموافقات من الهاتف.', steps: ['تأكد أن سير العمل في n8n مفعّل (Active)', '«إصلاح الآن» يعيد إرسالها'], link: '/settings/n8n' });
  if (isBad('drive', 'drive_archive') || (ar.dead && configured)) advice.push({ id: 'drive_archive_retry', category: 'integration', severity: 'medium', title: 'أرشفة منشورات على Google Drive فشلت', evidence: chk('drive', 'drive_archive')?.value ?? '', why: 'الأرشيف هو نسختك خارج الخادم؛ الفاشل لا يُحفظ.', steps: ['اختبر الأرشيف في إعدادات الربط', '«إصلاح الآن» يعيد المحاولة'], link: '/settings/integrations' });
  if (isBad('drive', 'drive_script')) advice.push({ id: 'drive_script_old', category: 'integration', severity: 'high', title: 'سكربت أرشيف Google قديم', evidence: `${chk('drive', 'drive_script')!.value} والمطلوب v${SCRIPT_VERSION}`, why: 'الإصدار القديم لا يدعم النسخ الاحتياطي والتحقق الجديد.', steps: ['إعدادات الربط ← أرشيف Google ← انسخ السكربت', 'Apps Script ← Deploy ← Manage deployments ← New version'], link: '/settings/integrations' });
  if (isBad('drive', 'drive_test')) advice.push({ id: 'drive_test_failed', category: 'integration', severity: 'high', title: 'آخر اختبار لأرشيف Google فشل', evidence: ga.lastTest?.message ?? '', why: 'لا أرشيف ولا نسخ احتياطي خارج الخادم.', steps: ['إعدادات الربط ← أرشيف Google ← «اختبار»', 'تحقق من صلاحية «Anyone» في نشر السكربت'], link: '/settings/integrations' });
  if (isBad('printshop', 'shop_unanswered')) advice.push({ id: 'shop_unanswered', category: 'growth', severity: 'high', title: 'عملاء ينتظرون الرد', evidence: `${unanswered} استفسار جديد بلا رد منذ أكثر من ساعتين`, why: 'العميل يطلب من أول مطبعة ترد — التأخير بيع ضائع.', steps: ['العملاء المحتملون ← «ردود جاهزة» ← أرسل عبر واتساب', 'فعّل إشعارات العملاء الجدد'], link: '/leads' });
  if (isBad('printshop', 'shop_followups') || chk('printshop', 'shop_followups')?.status === 'warn') advice.push({ id: 'shop_followups', category: 'growth', severity: overdue > 5 ? 'high' : 'medium', title: 'متابعات عملاء متأخرة', evidence: `${overdue} عميل موعد متابعته فات`, why: 'معظم الصفقات تُغلق في المتابعة الثانية أو الثالثة.', steps: ['العملاء ← «أولويات اليوم»', 'استخدم نص «متابعة 1/2» الجاهز'], link: '/leads' });
  if (isBad('printshop', 'shop_production') || lateProof) advice.push({ id: 'shop_board', category: 'publishing', severity: b.stuck.length ? 'high' : 'medium', title: 'طلبات طباعة تحتاج تدخلًا اليوم', evidence: `${b.stuck.length} متوقف · ${b.readyNotCollected.length} جاهز لم يُستلم · ${lateProof} بروفة بلا رد`, why: 'التأخير في الإنتاج أو التسليم يضر السمعة والتقييمات.', steps: ['PRINT DESIGN STUDIO ← لوحة المشاريع', '«إصلاح الآن» يرسل تذكير المتابعة الآن'], link: '/print-studio' });
  return { at: now.toISOString(), cards, advice };
}
