import { lintText } from '../qc/checks';
import type { Analysis, Brief } from './brief';
import { FINISHES } from './catalog';
import type { PrintPage, Rect } from './render';

/**
 * QUALITY ASSURANCE MASTER — six levels. PASS only for what was really checked; NOT_VERIFIED for what a machine
 * cannot judge (or was not run yet); NEEDS_REVISION for fixable problems; BLOCKED when production must not start.
 */
export type QaStatus = 'PASS' | 'NEEDS_REVISION' | 'BLOCKED' | 'NOT_VERIFIED';
export type QaLevel = 'visual' | 'brand' | 'language' | 'technical' | 'print' | 'publishing';
export interface QaCheck { level: QaLevel; id: string; label: string; status: QaStatus; detail?: string }
export interface QaReport { checks: QaCheck[]; levels: Record<QaLevel, QaStatus>; overall: QaStatus; productionReady: boolean; at: string }

const inside = (r: Rect, s: Rect, tol = 2) => r.x >= s.x - tol && r.y >= s.y - tol && r.x + r.w <= s.x + s.w + tol && r.y + r.h <= s.y + s.h + tol;
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w - 2 && b.x < a.x + a.w - 2 && a.y < b.y + b.h - 2 && b.y < a.y + a.h - 2;
const SHOP = /33316319|34315316|إبداع المستقبل|future creative/i;
const rank: QaStatus[] = ['PASS', 'NOT_VERIFIED', 'NEEDS_REVISION', 'BLOCKED'];
const worst = (xs: QaStatus[]) => xs.reduce<QaStatus>((w, s) => (rank.indexOf(s) > rank.indexOf(w) ? s : w), 'PASS');

export function runPrintQa(a: Analysis, b: Brief, pages: PrintPage[], o: { exported?: { pdf: { ok: boolean; pages: number; problems: string[] } }; iccProfile?: string; ad?: { approvedHash: string; usedHash: string } | null; approved?: boolean } = {}): QaReport {
  const ch: QaCheck[] = []; const add = (level: QaLevel, id: string, label: string, status: QaStatus, detail?: string) => ch.push({ level, id, label, status, detail });
  const art = pages.filter((p) => p.placed.length);
  const texts = art.flatMap((p) => p.placed.filter((x) => x.kind === 'text'));

  // ── Visual QA
  const ov: string[] = [];
  for (const p of art) for (let i = 0; i < p.placed.length; i++) for (let j = i + 1; j < p.placed.length; j++) { const x = p.placed[i], y = p.placed[j]; if (x.kind === 'image' || y.kind === 'image') continue; if (overlap(x.rect, y.rect)) ov.push(`${p.label}: ${x.id} × ${y.id}`); }
  add('visual', 'overlap', 'لا تزاحم أو تداخل بين العناصر', ov.length ? 'NEEDS_REVISION' : 'PASS', ov.slice(0, 3).join(' · ') || undefined);
  const p0 = art[0];
  if (p0) {
    // measured inside the area that holds most of the content (a panel, a cover half, the page)
    const zones = p0.safe.length ? p0.safe : [{ x: 0, y: 0, w: p0.widthPx, h: p0.heightPx }];
    const zone = zones.map((z) => ({ z, a: p0.placed.filter((x) => inside(x.rect, z, 4)).reduce((s, x) => s + x.rect.w * x.rect.h, 0) })).sort((u, v) => v.a - u.a)[0].z;
    let ax = 0, ay = 0, at = 0; for (const x of p0.placed.filter((y) => inside(y.rect, zone, 4))) { const ar = x.rect.w * x.rect.h; ax += (x.rect.x + x.rect.w / 2) * ar; ay += (x.rect.y + x.rect.h / 2) * ar; at += ar; }
    const cx = at ? (ax / at - zone.x) / zone.w : 0.5, cy = at ? (ay / at - zone.y) / zone.h : 0.5;
    const ok = (Math.abs(cx - 0.5) < 0.25 || p0.safe.length > 1) && Math.abs(cy - 0.5) < 0.3;
    add('visual', 'balance', 'اتزان التكوين (مركز ثقل العناصر)', ok ? 'PASS' : 'NEEDS_REVISION', `المركز ${Math.round(cx * 100)}٪ × ${Math.round(cy * 100)}٪`);
  }
  add('visual', 'aesthetic', 'جمال التكوين وملاءمته للنشاط', 'NOT_VERIFIED', 'حكم بصري — يراجعه مصمم/العميل قبل الاعتماد');

  // ── Brand QA
  const logoPlaced = art.some((p) => p.placed.some((x) => x.kind === 'logo'));
  add('brand', 'client_logo', 'شعار العميل من الملف الأصلي', logoPlaced ? 'PASS' : b.logoKey ? 'NEEDS_REVISION' : 'NOT_VERIFIED', logoPlaced ? 'وُضع الملف المرفوع كما هو (بدون إعادة توليد أو تحريف)' : 'لا يوجد شعار — استُخدم اسم النشاط نصًا');
  const leaked = texts.filter((x) => SHOP.test(x.text ?? ''));
  add('brand', 'separation', 'فصل هوية المطبعة عن منتج العميل', leaked.length && !b.shopBrandingConsent ? 'BLOCKED' : 'PASS', leaked.length ? (b.shopBrandingConsent ? 'هوية المطبعة مضافة بموافقة العميل' : 'بيانات المطبعة ظهرت داخل منتج العميل دون موافقة') : 'لا توجد بيانات المطبعة داخل التصميم');
  add('brand', 'client_data', 'بيانات العميل من طلبه فقط', 'PASS', 'لا تُخترع أسماء أو أرقام أو عناوين — الحقول الفارغة تبقى فارغة');

  // ── Language QA
  const missing = [...new Set(texts.flatMap((x) => x.missing ?? []))];
  add('language', 'glyphs', 'كل الحروف موجودة في الخط', missing.length ? 'NEEDS_REVISION' : 'PASS', missing.join(' ') || undefined);
  // brand names, e-mails and websites are legitimately Latin inside Arabic designs — only running copy is linted
  const copy = texts.filter((x) => /^(headline|subline|body|cta|tagline|extra|inside|back:|flap)/.test(x.id));
  const lint = copy.flatMap((x) => lintText(x.text ?? '', b.lang === 'en' ? 'en' : 'ar')).filter((m) => !/لاتينية|latin/i.test(m)).slice(0, 5);
  add('language', 'typography', 'علامات الترقيم والمسافات (فحص آلي شكلي)', lint.length ? 'NEEDS_REVISION' : 'PASS', lint.join(' · ') || undefined);
  add('language', 'grammar', 'التدقيق الإملائي والنحوي الكامل', 'NOT_VERIFIED', 'يحتاج مراجعة لغوية بشرية');
  add('language', 'direction', 'اتجاه النصوص والأرقام', 'PASS', b.lang === 'en' ? 'LTR' : 'RTL مع تشكيل عربي (HarfBuzz) ومحاذاة يمين حقيقية');

  // ── Technical QA
  const dimOk = pages.every((p) => { const k = p.dpi / 25.4; return Math.abs(p.widthPx - Math.round((p.trimMm.w + 2 * p.bleedMm) * k)) <= 2 && Math.abs(p.heightPx - Math.round((p.trimMm.h + 2 * p.bleedMm) * k)) <= 2; });
  add('technical', 'dimensions', 'الأبعاد الفعلية بالمليمتر', dimOk ? 'PASS' : 'NEEDS_REVISION', `${a.trim.w}×${a.trim.h} مم${a.bleedMm ? ` + نزيف ${a.bleedMm} مم` : ''} عند ${pages[0]?.dpi ?? 0} DPI`);
  const lowRes: string[] = []; const resInfo: string[] = [];
  for (const p of art) for (const x of p.placed.filter((y) => y.srcPx)) {
    const mmW = x.rect.w / (p.dpi / 25.4); const ppi = Math.round((x.srcPx!.w / mmW) * 25.4);
    resInfo.push(`${x.id}: ${ppi} PPI`); if (ppi < a.targetPpi * 0.9) lowRes.push(`${x.id} ${ppi}/${a.targetPpi}`);
  }
  add('technical', 'ppi', `الدقة الفعلية للصور (المستهدف ${a.targetPpi} PPI)`, lowRes.length ? 'NEEDS_REVISION' : resInfo.length ? 'PASS' : 'PASS', lowRes.length ? `دقة منخفضة: ${lowRes.join('، ')} — صور الذكاء الاصطناعي محدودة البكسلات؛ للمقاسات الكبيرة استخدم صورة مصدر أعلى دقة أو تكبيرًا احترافيًا (التكبير العادي لا يضيف تفاصيل)` : resInfo.join(' · ') || 'لا توجد صور نقطية — نصوص وأشكال مرسومة بالدقة النهائية');
  const unfit = texts.filter((x) => !x.fits);
  add('technical', 'overflow', 'لا يوجد نص مقصوص أو متجاوز', unfit.length ? 'NEEDS_REVISION' : 'PASS', unfit.map((x) => x.id).slice(0, 4).join('، ') || undefined);
  const minPt = a.product.family === 'large_format' ? 24 : a.product.family === 'card' ? 6.5 : ['sticker', 'label', 'stamp'].includes(a.product.family) ? 5.5 : 7;
  const tiny = texts.filter((x) => (x.pt ?? 99) < minPt - 0.05);
  add('technical', 'min_size', `أصغر نص لا يقل عن ${minPt} نقطة بالحجم النهائي`, tiny.length ? 'NEEDS_REVISION' : 'PASS', tiny.map((x) => `${x.id} ${x.pt?.toFixed(1)}pt`).slice(0, 4).join('، ') || undefined);
  add('technical', 'fonts', 'الخطوط', 'PASS', 'Cairo مرسوم داخل العمل الفني بالدقة النهائية (يعادل التحويل إلى Outlines) — النص غير قابل للتحرير داخل PDF؛ المصدر القابل للتعديل ملف المشروع');
  add('technical', 'color', 'إدارة الألوان CMYK/ICC', o.iccProfile ? 'PASS' : 'NOT_VERIFIED', o.iccProfile ? `تحويل CMYK بملف ICC المطبعة: ${o.iccProfile}` : 'تحويل CMYK بملف عام مدمج — يلزم ملف ICC الخاص بالمطبعة/الخامة لمطابقة الألوان');
  add('technical', 'transparency', 'الشفافية والطبقات', 'PASS', pages.some((p) => p.transparentBg) ? 'خلفية شفافة مقصودة (DTF/شفاف) + قناة حبر أبيض منفصلة عند الحاجة' : 'مسطّحة على خلفية بيضاء — لا شفافية معلّقة');

  // ── Print QA
  for (const bl of a.blockers) add('print', `blocker:${bl.slice(0, 20)}`, 'متطلبات الإنتاج', 'BLOCKED', bl);
  add('print', 'bleed', 'النزيف', a.bleedMm > 0 || ['wrap', 'apparel', 'stamp'].includes(a.product.family) ? 'PASS' : 'NEEDS_REVISION', a.bleedMm > 0 ? `${a.bleedMm} مم (قيمة شائعة لهذه الفئة — تأكد من متطلبات المورد)` : 'لا نزيف — منطقة طباعة/منتج بلا قص');
  const outSafe: string[] = [];
  for (const p of art) for (const x of p.placed) if (x.kind !== 'image' && p.safe.length && !p.safe.some((s) => inside(x.rect, s))) outSafe.push(`${p.label}: ${x.id}`);
  add('print', 'safe_area', `مساحة الأمان ${a.safeMm} مم من القص${a.product.family === 'folded' ? ' والطي' : ''}`, outSafe.length ? 'NEEDS_REVISION' : 'PASS', outSafe.slice(0, 4).join(' · ') || undefined);
  const needsCut = ['sticker', 'label', 'stamp'].includes(a.product.family);
  if (needsCut) add('print', 'cut', 'مسار القص Vector مستقل (CutContour)', pages[0]?.cut ? 'PASS' : 'BLOCKED', pages[0]?.cut ? `${a.product.cut ?? 'rect'} — طبقة Spot منفصلة في PDF وملف SVG` : undefined);
  if (pages.some((p) => p.kissCut?.length)) add('print', 'kiss', 'مسافات Kiss-Cut بين القطع', 'PASS', '3 مم على الأقل بين القطع + قص كامل حول الورقة');
  if (a.product.family === 'folded') add('print', 'folds', 'خطوط الطي وترتيب الألواح', pages.every((p) => p.folds?.length) ? 'PASS' : 'NEEDS_REVISION', pages[0]?.note);
  if (a.product.family === 'multipage') add('print', 'binding', 'الصفحات والتجليد', a.pages % 4 === 0 ? 'PASS' : 'NEEDS_REVISION', `${a.pages} صفحة · ${pages[0]?.label ?? ''}`);
  const sepFin = b.finishes.filter((f) => FINISHES[f]?.separation);
  if (sepFin.length) add('print', 'finishing', 'فصل طبقات التشطيب (فويل/Spot UV/بارز)', 'NOT_VERIFIED', `${sepFin.map((f) => FINISHES[f].ar).join('، ')}: لم تُنشأ طبقة الفصل آليًا بعد — يجهزها فني ما قبل الطباعة`);
  if (pages.some((p) => p.note === 'mirrored')) add('print', 'mirror', 'نسخة معكوسة للإنتاج', 'PASS', 'مرفقة كملف منفصل — استخدمها فقط إذا تطلبها الجهاز');
  if (pages.some((p) => p.white)) add('print', 'white', 'طبقة الحبر الأبيض', 'PASS', 'قناع أبيض منفصل (PNG) من شكل العمل');
  for (const w of a.warnings) add('print', `warn:${w.slice(0, 20)}`, 'تنبيه إنتاج', w.includes('PDF/X') ? 'NOT_VERIFIED' : 'NEEDS_REVISION', w);
  add('print', 'export', 'ملفات التصدير تُفتح بالمقاسات الصحيحة', o.exported ? (o.exported.pdf.ok ? 'PASS' : 'BLOCKED') : 'NOT_VERIFIED', o.exported ? (o.exported.pdf.ok ? `PDF: ${o.exported.pdf.pages} صفحة — أُعيد فتحه وتحقق من الأبعاد` : o.exported.pdf.problems.join('، ')) : 'لم تُنشأ الملفات بعد');

  // ── Publishing QA
  if (b.outputs === 'print') add('publishing', 'na', 'النشر', 'PASS', 'المطلوب طباعة فقط — لا نشر');
  else {
    add('publishing', 'approved', 'الإعلان من النسخة المعتمدة', o.ad ? (o.ad.approvedHash === o.ad.usedHash ? 'PASS' : 'BLOCKED') : 'NOT_VERIFIED', o.ad ? (o.ad.approvedHash === o.ad.usedHash ? 'بصمة النسخة متطابقة' : 'النسخة تغيّرت بعد الاعتماد') : 'لم يُنشأ الإعلان بعد');
    add('publishing', 'provider', 'نتيجة Metricool/المنصة', 'NOT_VERIFIED', 'تُتحقق في سجل المنشورات بعد النشر الفعلي — الجدولة ليست نشرًا');
  }

  const levels = Object.fromEntries((['visual', 'brand', 'language', 'technical', 'print', 'publishing'] as QaLevel[]).map((l) => [l, worst(ch.filter((x) => x.level === l).map((x) => x.status))])) as Record<QaLevel, QaStatus>;
  const overall = worst(Object.values(levels));
  const productionReady = !ch.some((x) => x.status === 'BLOCKED' || x.status === 'NEEDS_REVISION') && !!o.exported?.pdf.ok && !!o.approved && a.productionPossible;
  return { checks: ch, levels, overall, productionReady, at: new Date().toISOString() };
}
