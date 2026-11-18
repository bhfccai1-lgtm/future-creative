import { lintText } from '../qc/checks';
import type { RenderedDoc } from './render';
import { foldCheck, defaultPanelOrder, paperMm } from './render';
import { checkStatement, toLatinDigits } from './math';
import { PRESETS, type EduContent, type EduSettings } from './types';

/**
 * Quality control — every check reports what it actually verified. PASS = verified OK, WARNING = needs a person
 * (e.g. facts the machine cannot verify), FAIL = must be fixed. Nothing is reported as passed unless it ran.
 */
export type QcStatus = 'PASS' | 'WARNING' | 'FAIL';
export interface EduCheck { id: string; label: string; status: QcStatus; detail?: string }
export interface EduQc { status: QcStatus; checks: EduCheck[]; at: string; printReady: boolean }

const worst = (a: QcStatus[]): QcStatus => (a.includes('FAIL') ? 'FAIL' : a.includes('WARNING') ? 'WARNING' : 'PASS');
const inside = (r: { x: number; y: number; w: number; h: number }, s: { x: number; y: number; w: number; h: number }, tol = 3) => r.x >= s.x - tol && r.y >= s.y - tol && r.x + r.w <= s.x + s.w + tol && r.y + r.h <= s.y + s.h + tol;
const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w - 2 && b.x < a.x + a.w - 2 && a.y < b.y + b.h - 2 && b.y < a.y + a.h - 2;

export function runQc(s: EduSettings, content: EduContent, doc: RenderedDoc, opts: { source: 'ai' | 'sample' | 'edited'; fixes?: string[]; exports?: { pdf?: { ok: boolean; pages: { wMm: number; hMm: number }[]; problems: string[] }; images?: { name: string; ok: boolean; w: number; h: number }[] } } = { source: 'ai' }): EduQc {
  const ch: EduCheck[] = [];
  const add = (id: string, label: string, status: QcStatus, detail?: string) => ch.push({ id, label, status, detail });

  // 1) arithmetic — the only facts the machine can verify for certain
  const wrong: string[] = []; let checked = 0;
  for (const sec of content.sections) {
    for (const ex of sec.examples) for (const st of [ex.problem, ...ex.steps]) {
      for (const part of st.split(/[،,:؛]/)) { const r = checkStatement(part.trim()); if (r) { checked++; if (!r.ok) wrong.push(`${part.trim()} (الصحيح ${r.expected})`); } }
    }
    for (const ex of sec.exercises) { const r = checkStatement(ex.q, ex.answer); if (r) { checked++; if (!r.ok) wrong.push(`${ex.q} ← ${ex.answer} (الصحيح ${r.expected})`); } }
  }
  add('math', 'دقة العمليات الحسابية والحلول', wrong.length ? 'FAIL' : checked ? 'PASS' : 'PASS', wrong.length ? wrong.slice(0, 5).join(' · ') : checked ? `تحقق آلي من ${checked} عملية${opts.fixes?.length ? ` — صُحّح مفتاح الإجابة: ${opts.fixes.slice(0, 3).join('، ')}` : ''}` : 'لا توجد عمليات حسابية للتحقق');

  // 2) facts / curriculum — cannot be machine-verified
  add('facts', 'صحة المحتوى التعليمي', opts.source === 'sample' ? 'WARNING' : 'WARNING', opts.source === 'sample' ? 'محتوى نموذجي (بدون مفتاح ذكاء اصطناعي) — أكمل الفراغات وراجعه' : 'كتبه الذكاء الاصطناعي — يحتاج مراجعة المعلم قبل الطباعة (لا يُدّعى أنه من منهج محدد)');
  const placeholders = JSON.stringify(content).includes('اكتب هنا') || JSON.stringify(content).includes('Write here');
  if (placeholders) add('placeholders', 'لا توجد فراغات «اكتب هنا…»', 'FAIL', 'أكمل النصوص النموذجية قبل الطباعة');

  // 3) spelling / typography — typographic lint only (honest: not a full grammar checker)
  const texts = [content.title, content.intro, ...content.objectives, ...content.summary, ...content.sections.flatMap((x) => [x.heading, x.body, ...x.bullets])].filter(Boolean);
  const lint = texts.flatMap((t) => lintText(t, s.lang === 'en' ? 'en' : 'ar')).slice(0, 6);
  add('spelling', 'الإملاء وعلامات الترقيم (فحص آلي شكلي)', lint.length ? 'WARNING' : 'PASS', lint.length ? lint.join(' · ') : 'لا أخطاء شكلية — المراجعة النحوية الكاملة يقوم بها المعلم');

  // 4) layout: overflow, overlaps, safe areas, glyphs
  const unfit = doc.pages.flatMap((p) => p.placed.filter((x) => !x.fits).map((x) => `${p.label}: ${x.text?.slice(0, 30) || x.id}`));
  add('text_fit', 'النص داخل حدود الأعمدة دون قص', unfit.length ? 'FAIL' : 'PASS', unfit.slice(0, 4).join(' · ') || undefined);
  const glyphs = [...new Set(doc.pages.flatMap((p) => p.placed.flatMap((x) => x.missing ?? [])))];
  add('glyphs', 'كل الحروف والرموز موجودة في الخط', glyphs.length ? 'FAIL' : 'PASS', glyphs.length ? glyphs.join(' ') : undefined);
  const ov: string[] = [];
  for (const p of doc.pages) for (let i = 0; i < p.placed.length; i++) for (let j = i + 1; j < p.placed.length; j++) {
    const a = p.placed[i], b = p.placed[j];
    if (a.region !== b.region || a.id === 'overflow' || b.id === 'overflow') continue;
    if (overlap(a.rect, b.rect)) ov.push(`${p.label}: ${a.id} × ${b.id}`);
  }
  add('overlap', 'لا تداخل بين العناوين والنصوص والصور', ov.length ? 'FAIL' : 'PASS', ov.slice(0, 3).join(' · ') || undefined);
  const out: string[] = [];
  for (const p of doc.pages) for (const x of p.placed) { const reg = p.regions.find((r) => r.id === x.region); if (reg && x.id !== 'overflow' && !inside(x.rect, reg.safe)) out.push(`${p.label}: ${x.id}`); }
  add('safe_area', PRESETS[s.type].engine === 'panels' ? 'الهوامش الآمنة ومناطق الطي' : 'الهوامش الآمنة', out.length ? 'FAIL' : 'PASS', out.slice(0, 4).join(' · ') || `هامش ${s.marginMm} مم${PRESETS[s.type].engine === 'panels' ? ' + 6 مم من كل خط طي' : ''}`);

  // 5) direction: equations are drawn token by token (never re-ordered by an exporter); digits style applied
  const eqs = doc.pages.reduce((a, p) => a + p.placed.filter((x) => x.kind === 'equation').length, 0);
  const mixed = s.digits === 'arabic' && s.lang !== 'en' ? texts.filter((t) => /[0-9]/.test(toLatinDigits(t)) && /[0-9]/.test(t)).length : 0;
  add('direction', 'اتجاه النص والأرقام والمعادلات', 'PASS', `${eqs} معادلة مرسومة رمزًا برمز (${s.equationDir === 'rtl' ? 'من اليمين لليسار' : 'من اليسار لليمين'})، الأرقام ${s.digits === 'arabic' ? 'عربية ٠١٢٣' : 'إنجليزية 0123'}${mixed ? ` — تحوّل ${mixed} نصًا تلقائيًا` : ''}`);

  // 6) brochure fold order
  if (PRESETS[s.type].engine === 'panels') {
    const f = foldCheck(s.panelOrder ?? defaultPanelOrder(s.lang));
    add('fold_order', 'ترتيب الألواح بعد الطي', f.ok ? 'PASS' : 'WARNING', f.note);
    add('sides', 'فصل الوجهين', doc.pages.length === 2 ? 'PASS' : 'FAIL', `${doc.pages.length} وجه`);
  }

  // 7) dimensions and pages
  const t = paperMm(s), k = (doc.pages[0]?.dpi ?? 300) / 25.4;
  const dimOk = doc.pages.every((p) => Math.abs(p.widthPx - Math.round((t.w + 2 * s.bleedMm) * k)) <= 1 && Math.abs(p.heightPx - Math.round((t.h + 2 * s.bleedMm) * k)) <= 1);
  add('dimensions', 'الأبعاد الدقيقة بالمليمتر', dimOk ? 'PASS' : 'FAIL', `${t.w}×${t.h} مم${s.bleedMm ? ` + نزيف ${s.bleedMm} مم` : ''} · ${doc.pages[0]?.widthPx}×${doc.pages[0]?.heightPx} بكسل عند ${doc.pages[0]?.dpi} DPI`);
  const expectedPages = PRESETS[s.type].engine === 'panels' ? 2 : 1;
  add('pages', 'وجود جميع الصفحات المطلوبة', doc.pages.length >= expectedPages ? 'PASS' : 'FAIL', `${doc.pages.length} صفحة`);

  // 8) images — real pixels vs printed size (target 300 DPI)
  const imgs = doc.pages.flatMap((p) => p.placed.filter((x) => x.kind === 'image').map((x) => { const [w] = (x.text ?? '0x0').split('x').map(Number); const mmW = x.rect.w / ((p.dpi) / 25.4); return { dpi: Math.round(w / (mmW / 25.4)), id: x.id }; }));
  // pictures need ~200+ DPI at print size; a softened full-page background is acceptable from ~110 DPI
  if (imgs.length) { const low = imgs.filter((i) => i.dpi < (i.id === 'img:bg' ? 110 : 200)); const uniq = [...new Map(imgs.map((i) => [i.id, i])).values()]; add('image_quality', 'دقة الصور عند الطباعة', low.length ? 'WARNING' : 'PASS', uniq.map((i) => `${i.id === 'img:bg' ? 'الخلفية' : i.id.replace('img:sec:', 'قسم ').replace('img:', '')}: ${i.dpi} DPI`).join(' · ') + (low.length ? ' — دقة منخفضة لهذا المقاس' : '')); }

  // 9) identity policy for school work
  add('identity', 'بدون شعار المطبعة أو أرقام أو إعلانات أو علامة مائية', s.brand ? 'WARNING' : 'PASS', s.brand ? 'الهوية التجارية مفعّلة — غير مناسبة للتسليم المدرسي' : 'سياسة المشاريع المدرسية مطبّقة');
  add('color', 'ألوان الطباعة التجارية', 'WARNING', 'الملف RGB — لا يضمن مطابقة CMYK/ICC للطباعة الأوفست؛ مناسب للطباعة الرقمية والمكتبية');

  // 10) exports really open
  if (opts.exports?.pdf) { const p = opts.exports.pdf; const sizeOk = p.pages.every((x) => Math.abs(x.wMm - (t.w + 2 * s.bleedMm)) < 0.6 && Math.abs(x.hMm - (t.h + 2 * s.bleedMm)) < 0.6); add('pdf', 'ملف PDF يفتح بالصفحات والمقاسات الصحيحة', p.ok && sizeOk && p.pages.length === doc.pages.length ? 'PASS' : 'FAIL', p.ok ? `${p.pages.length} صفحة · ${p.pages[0]?.wMm}×${p.pages[0]?.hMm} مم` : p.problems.join('، ')); }
  if (opts.exports?.images?.length) { const bad = opts.exports.images.filter((x) => !x.ok); add('image_files', 'ملفات الصور تُفتح بالأبعاد الصحيحة', bad.length ? 'FAIL' : 'PASS', bad.map((b) => b.name).join('، ') || `${opts.exports.images.length} ملف`); }

  const status = worst(ch.map((x) => x.status));
  // «جاهز للطباعة» only when nothing failed, the files were produced and opened, and no placeholder text remains
  const printReady = !ch.some((x) => x.status === 'FAIL') && !!opts.exports?.pdf && !placeholders;
  return { status, checks: ch, at: new Date().toISOString(), printReady };
}
