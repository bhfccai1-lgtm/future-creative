'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from './ui';
import { toast } from './toaster';
import { apiCall } from '@/lib/client/api';
import { GRADES, GRADES_EN, STAGE_AR, SUBJECTS, gradeIndex, lessonIdeas, officialLessons, stageOf, type CurriculumEntry } from '@/lib/edu/choices';
import { EDU_TYPES, PRESETS, STYLES, STYLE_AR, STEPS, type EduContent, type EduSettings, type EduType, type StepState } from '@/lib/edu/types';

/**
 * EDUCATION MASTER AI V4.0 — production studio. Every button calls the server (create → content → layout →
 * preview → edit → export → QC); statuses come from what the server actually did. No fake results.
 */
type Lang = 'ar' | 'en';
const T: Record<string, [string, string]> = {
  new: ['مشروع جديد', 'New project'], mine: ['مشاريعي', 'My projects'], templates: ['القوالب الجاهزة', 'Templates'], preview: ['المعاينة والتحرير', 'Preview & edit'], export: ['التصدير', 'Export'], settings: ['الإعدادات', 'Settings'],
  type: ['نوع التصميم', 'Design type'], lang: ['اللغة', 'Language'], subject: ['المادة الدراسية', 'Subject'], grade: ['الصف الدراسي', 'Grade'], lesson: ['عنوان الدرس', 'Lesson title'], objectives: ['أهداف التعلم (اختياري)', 'Learning objectives (optional)'],
  student: ['اسم الطالب (اختياري)', 'Student name (optional)'], classSection: ['الصف والفرقة (اختياري)', 'Class / section (optional)'], school: ['اسم المدرسة (اختياري)', 'School (optional)'],
  size: ['المقاس', 'Size'], orientation: ['الاتجاه', 'Orientation'], sides: ['الوجه', 'Sides'], columns: ['عدد الأعمدة', 'Columns'], style: ['النمط البصري', 'Visual style'], palette: ['الألوان', 'Colours'], detail: ['مستوى التفاصيل', 'Detail'], images: ['كثافة الصور', 'Images'], fontScale: ['حجم الخط', 'Font size'],
  digits: ['الأرقام', 'Digits'], equationDir: ['اتجاه المعادلات', 'Equation direction'], exerciseCount: ['عدد التمارين', 'Exercises'], cardCount: ['عدد البطاقات', 'Cards'], marginMm: ['الهامش الآمن (مم)', 'Safe margin (mm)'], bleedMm: ['نزيف الطباعة (مم)', 'Bleed (mm)'], answerKey: ['صفحة مفتاح الإجابات', 'Answer-key page'],
  create: ['إنشاء التصميم', 'Create design'], working: ['جارٍ التنفيذ…', 'Working…'], save: ['حفظ وتحديث المعاينة', 'Save & refresh preview'], undo: ['تراجع عن آخر تعديل', 'Undo last edit'], rewrite: ['إعادة كتابة القسم بالذكاء الاصطناعي', 'Rewrite section with AI'],
  folds: ['خطوط الطي', 'Fold lines'], safe: ['الهوامش الآمنة', 'Safe margins'], zoom: ['التكبير', 'Zoom'], compare: ['مقارنة بالنسخة السابقة', 'Compare with previous'], exportBtn: ['إنشاء ملفات الطباعة (300 DPI)', 'Create print files (300 DPI)'],
  steps: ['مراحل الإنتاج', 'Production steps'], qc: ['فحص الجودة', 'Quality control'], open: ['فتح', 'Open'], del: ['حذف', 'Delete'], noProjects: ['لا توجد مشاريع بعد.', 'No projects yet.'], useTemplate: ['استخدم القالب', 'Use template'],
};
const STEP_AR: Record<string, [string, string]> = { input: ['إدخال المعلومات', 'Input'], validate: ['التحقق من البيانات', 'Validation'], plan: ['خطة المحتوى', 'Content plan'], content: ['النصوص والأمثلة', 'Text & examples'], review: ['فحص المحتوى', 'Content review'], images: ['الرسومات', 'Illustrations'], layout: ['تنسيق الصفحات', 'Layout'], preview: ['المعاينة', 'Preview'], edit: ['المراجعة والتعديل', 'Review & edit'], export: ['ملفات التصدير', 'Export files'], qc: ['فحص الجودة', 'Quality control'], download: ['التنزيل', 'Download'] };
const PALETTES: [EduSettings['palette'], string][] = [['blue', '#1d4ed8'], ['green', '#15803d'], ['purple', '#6d28d9'], ['orange', '#c2410c'], ['navy_gold', '#0b1730'], ['pink', '#be185d']];
const TEMPLATES: { ar: string; en: string; s: Partial<EduSettings> & { type: EduType } }[] = [
  { ar: 'مطوية رياضيات — الجمع والطرح (الصف الثالث)', en: 'Maths brochure — addition & subtraction', s: { type: 'brochure', subject: 'الرياضيات', grade: 'الصف الثالث', lesson: 'الجمع والطرح', palette: 'blue' } },
  { ar: 'بوستر التربية الإسلامية — أركان الإيمان', en: 'Islamic studies poster — pillars of faith', s: { type: 'poster', subject: 'التربية الإسلامية', grade: 'الصف الرابع', lesson: 'أركان الإيمان', orientation: 'landscape', palette: 'green' } },
  { ar: 'ورقة عمل رياضيات بخانات إجابة', en: 'Maths worksheet with answer boxes', s: { type: 'worksheet', subject: 'الرياضيات', grade: 'الصف الثالث', lesson: 'الجمع والطرح', exerciseCount: 10, answerKey: true } },
  { ar: 'بطاقات تعليمية — كلمات إنجليزية', en: 'Flash cards — English words', s: { type: 'flashcards', subject: 'اللغة الإنجليزية', grade: 'الصف الثاني', lesson: 'الحيوانات', lang: 'bi', cardCount: 8 } },
  { ar: 'شهادة تقدير مدرسية', en: 'School certificate', s: { type: 'certificate', subject: 'القراءة', grade: 'الصف الخامس', lesson: 'تحدي القراءة', palette: 'navy_gold' } },
  { ar: 'خريطة ذهنية — دورة الماء', en: 'Mind map — water cycle', s: { type: 'mind_map', subject: 'العلوم', grade: 'الصف الرابع', lesson: 'دورة الماء في الطبيعة' } },
  { ar: 'غلاف مشروع مدرسي', en: 'Project cover', s: { type: 'project_cover', subject: 'الدراسات الاجتماعية', grade: 'الصف السادس', lesson: 'مملكة البحرين' } },
  { ar: 'جدول تعليمي — الضرب', en: 'Table — multiplication', s: { type: 'table', subject: 'الرياضيات', grade: 'الصف الثالث', lesson: 'جدول الضرب للعدد ٦' } },
];

type PreviewPage = { key: string; v: string; label: string; widthPx: number; heightPx: number; trimMm: { w: number; h: number }; bleedMm: number; dpi: number; folds: number[]; regions: { id: string; label: string; rect: { x: number; y: number; w: number; h: number }; safe: { x: number; y: number; w: number; h: number } }[] };
type Check = { id: string; label: string; status: 'PASS' | 'WARNING' | 'FAIL'; detail?: string };
type Qc = { status: 'PASS' | 'WARNING' | 'FAIL'; checks: Check[]; printReady: boolean };
type Project = { id: string; title: string; type: EduType; settings: EduSettings; content: EduContent | null; source: string | null; steps: StepState[] | null; qc: Qc | null; exports: { at: string; files: { kind: string; name: string; key: string; bytes: number }[] } | null; versions: unknown[] | null };
type Row = { id: string; title: string; type: EduType; updatedAt: string; source: string | null; qc: Qc | null };

const blank = (type: EduType): Partial<EduSettings> => ({ type, lang: 'ar', subject: '', grade: '', lesson: '', objectives: '', student: '', classSection: '', school: '', size: PRESETS[type].size, orientation: PRESETS[type].orientation, sides: PRESETS[type].sides, columns: PRESETS[type].columns, style: 'auto', palette: 'blue', detail: 'medium', images: 'none', fontScale: 1, digits: 'arabic', equationDir: 'rtl', exerciseCount: 8, cardCount: 8, marginMm: 10, bleedMm: 0, answerKey: false, autoFit: true, aiBackground: false });
const BADGE: Record<string, string> = { PASS: 'bg-emerald-100 text-emerald-800', WARNING: 'bg-amber-100 text-amber-800', FAIL: 'bg-red-100 text-red-800', done: 'bg-emerald-100 text-emerald-800', warning: 'bg-amber-100 text-amber-800', failed: 'bg-red-100 text-red-800', running: 'bg-sky-100 text-sky-800', pending: 'bg-slate-100 text-slate-500', skipped: 'bg-slate-100 text-slate-500' };

export function EduStudio({ initialProjects, aiLive, curriculum: cur0 = { curriculumYear: '2026-2027', curriculum: [] }, canAdmin = false }: { initialProjects: Row[]; aiLive: boolean; curriculum?: { curriculumYear: string; curriculum: CurriculumEntry[] }; canAdmin?: boolean }) {
  const [curriculum, setCurriculum] = useState(cur0);
  const [ui, setUi] = useState<Lang>('ar');
  const t = useCallback((k: string) => (T[k] ? T[k][ui === 'ar' ? 0 : 1] : k), [ui]);
  const [tab, setTab] = useState<'new' | 'mine' | 'templates' | 'preview' | 'export' | 'settings'>('new');
  const [form, setForm] = useState<Partial<EduSettings>>(blank('brochure'));
  const [rows, setRows] = useState<Row[]>(initialProjects);
  const [proj, setProj] = useState<Project | null>(null);
  const [pages, setPages] = useState<PreviewPage[]>([]);
  const [prevPages, setPrevPages] = useState<PreviewPage[]>([]);
  const [qc, setQc] = useState<Qc | null>(null);
  const [fit, setFit] = useState<{ fontScale: number; style: string } | null>(null);
  const [plan, setPlan] = useState<{ slots: { id: string; label: string; kind: string; done: boolean }[]; missing: number; costUsd: number; live: boolean } | null>(null);
  const [panelOrder, setPanelOrder] = useState<number[][] | null>(null);
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [showFolds, setShowFolds] = useState(true);
  const [showSafe, setShowSafe] = useState(false);
  const [compare, setCompare] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ msg: string; retry?: () => void } | null>(null);
  const [draft, setDraft] = useState<EduContent | null>(null);
  const [formats, setFormats] = useState<('pdf' | 'png' | 'jpg')[]>(['pdf', 'png']);

  // per-viewer conveniences (UI language) — never project data
  useEffect(() => { try { const v = localStorage.getItem('edu.ui'); if (v === 'en' || v === 'ar') setUi(v); } catch { /* storage blocked */ } }, []);
  useEffect(() => { try { localStorage.setItem('edu.ui', ui); } catch { /* storage blocked */ } }, [ui]);

  const preset = PRESETS[(form.type ?? 'brochure') as EduType];
  const has = (o: (typeof preset.options)[number]) => preset.options.includes(o);
  const set = <K extends keyof EduSettings>(k: K, v: EduSettings[K]) => setForm((f) => ({ ...f, [k]: v }));

  const run = useCallback(async <R,>(label: string, fn: () => Promise<R>, retry?: () => void): Promise<R | null> => {
    setBusy(label); setError(null);
    try { return await fn(); } catch (e) { const msg = (e as Error).message; setError({ msg, retry }); toast(msg, 'error'); return null; } finally { setBusy(null); }
  }, []);

  const refreshList = useCallback(async () => { const r = await apiCall<{ projects: Row[] }>('/api/edu/projects'); setRows(r.projects); }, []);
  const loadPreview = useCallback(async (id: string) => {
    const r = await apiCall<{ pages: PreviewPage[]; qc: Qc; panelOrder: number[][] | null; fontScale: number; style: string }>(`/api/edu/projects/${id}/preview`, { method: 'POST' });
    setFit({ fontScale: r.fontScale, style: r.style });
    setPrevPages((old) => (old.length ? old : r.pages)); setPages((cur) => { if (cur.length) setPrevPages(cur); return r.pages; });
    setQc(r.qc); setPanelOrder(r.panelOrder); setPage((p) => Math.min(p, r.pages.length - 1));
    const pr = await apiCall<{ project: Project }>(`/api/edu/projects/${id}`); setProj(pr.project); setDraft(pr.project.content);
    setPlan(await apiCall<{ slots: { id: string; label: string; kind: string; done: boolean }[]; missing: number; costUsd: number; live: boolean }>(`/api/edu/projects/${id}/images`).catch(() => null));
  }, []);
  const makeImages = useCallback(async (id: string, only?: string[]) => {
    await run('images', async () => { const r = await apiCall<{ message: string }>(`/api/edu/projects/${id}/images`, { body: only ? { only } : {} }); toast(r.message); await loadPreview(id); });
  }, [run, loadPreview]);
  const openProject = useCallback(async (id: string) => {
    await run('open', async () => { setPages([]); setPrevPages([]); const pr = await apiCall<{ project: Project }>(`/api/edu/projects/${id}`); setProj(pr.project); setDraft(pr.project.content); setTab('preview'); if (pr.project.content) await loadPreview(id); });
  }, [run, loadPreview]);

  const createAndGenerate = async () => {
    const missing = (['subject', 'grade', 'lesson'] as const).filter((k) => !String(form[k] ?? '').trim());
    if (missing.length) { setError({ msg: `${ui === 'ar' ? 'أكمل الحقول' : 'Fill in'}: ${missing.map((k) => t(k)).join('، ')}` }); return; }
    const created = await run('create', () => apiCall<{ id: string }>('/api/edu/projects', { body: form }));
    if (!created) return;
    const go = async () => { await run('generate', async () => { await apiCall(`/api/edu/projects/${created.id}/generate`, { method: 'POST' }); setPages([]); setPrevPages([]); await loadPreview(created.id); setTab('preview'); }, go); };
    await go();
    if (aiLive && (form.aiBackground || (form.images && form.images !== 'none' && has('images')))) await makeImages(created.id);
    await refreshList().catch(() => undefined);
  };

  const saveDraft = async (note = ui === 'ar' ? 'تعديل النص' : 'Text edit', settings?: Partial<EduSettings>) => {
    if (!proj) return;
    await run('save', async () => { await apiCall(`/api/edu/projects/${proj.id}`, { method: 'PATCH', body: { ...(draft ? { content: draft } : {}), ...(settings ? { settings } : {}), note } }); await loadPreview(proj.id); toast(ui === 'ar' ? 'حُفظ وتحدّثت المعاينة ✓' : 'Saved ✓'); });
  };
  const swapPanel = (side: number, a: number, b: number) => {
    if (!panelOrder) return;
    const next = panelOrder.map((o) => [...o]); [next[side][a], next[side][b]] = [next[side][b], next[side][a]];
    void saveDraft(ui === 'ar' ? 'تبديل ترتيب الأعمدة' : 'Panel order', { panelOrder: next });
  };

  const cur = compare && prevPages[page] ? prevPages[page] : pages[page];
  const steps = proj?.steps ?? [];
  const tabs = ['new', 'mine', 'templates', 'preview', 'export', 'settings'] as const;
  const dir = ui === 'ar' ? 'rtl' : 'ltr';

  return (
    <div dir={dir} className="space-y-4">
      {/* top bar */}
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gradient-to-l from-indigo-700 via-blue-700 to-sky-600 p-4 text-white shadow">
        <div><div className="text-xl font-extrabold tracking-wide">EDUCATION MASTER AI <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">V4.0</span></div><div className="text-xs opacity-90">{ui === 'ar' ? 'نظام إنتاج المطبوعات التعليمية — من الدرس حتى ملف الطباعة' : 'Educational print production — from lesson to print file'}</div></div>
        <div className="flex items-center gap-2 text-xs">
          <span className={`rounded-full px-2 py-1 font-bold ${aiLive ? 'bg-emerald-400/30' : 'bg-amber-400/40'}`}>{aiLive ? (ui === 'ar' ? 'الذكاء الاصطناعي متصل' : 'AI connected') : (ui === 'ar' ? 'وضع التجربة: محتوى نموذجي' : 'Dry-run: sample content')}</span>
          <button type="button" className="rounded-full bg-white/20 px-3 py-1 font-bold" onClick={() => setUi(ui === 'ar' ? 'en' : 'ar')}>{ui === 'ar' ? 'English' : 'عربي'}</button>
        </div>
      </header>
      <nav className="flex gap-1.5 overflow-x-auto pb-1 text-sm">{tabs.map((k) => (
        <button key={k} type="button" disabled={(k === 'preview' || k === 'export') && !proj} onClick={() => setTab(k)} className={`shrink-0 rounded-full border px-3 py-1.5 font-bold disabled:opacity-40 ${tab === k ? 'border-indigo-700 bg-indigo-700 text-white' : 'bg-white text-slate-700'}`}>{t(k)}</button>
      ))}</nav>
      {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><span>{error.msg}</span>{error.retry && <Button size="sm" variant="outline" onClick={error.retry}>{ui === 'ar' ? 'إعادة المحاولة' : 'Retry'}</Button>}</div>}
      {busy && <div className="rounded-xl bg-sky-50 p-3 text-sm font-bold text-sky-800">⏳ {t('working')} {busy === 'generate' ? (ui === 'ar' ? 'تحليل الدرس وكتابة المحتوى وتنسيق الصفحات (قد يستغرق دقيقة)' : 'analysing the lesson, writing and laying out (up to a minute)') : busy === 'export' ? (ui === 'ar' ? 'إنشاء ملفات 300 DPI وفحصها' : 'creating and checking 300-DPI files') : busy === 'images' ? (ui === 'ar' ? 'الذكاء الاصطناعي يرسم الصور (٣ في نفس الوقت — قد يستغرق دقيقة أو اثنتين)' : 'the AI is painting the pictures (3 at a time, 1–2 minutes)') : ''}</div>}

      {tab === 'new' && (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <section className="space-y-4 rounded-2xl border bg-white p-4">
            <div>
              <div className="label mb-2">{t('type')}</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">{EDU_TYPES.map((ty) => (
                <button key={ty} type="button" onClick={() => setForm((f) => ({ ...blank(ty), subject: f.subject, grade: f.grade, lesson: f.lesson, objectives: f.objectives, lang: f.lang, palette: f.palette }))} className={`rounded-xl border p-2 text-start text-xs font-bold ${form.type === ty ? 'border-indigo-600 bg-indigo-50 text-indigo-900' : 'bg-white text-slate-700'}`}>
                  {ui === 'ar' ? PRESETS[ty].ar : PRESETS[ty].en}<div className="mt-0.5 text-[10px] font-normal text-slate-500">{PRESETS[ty].size} · {PRESETS[ty].orientation === 'landscape' ? (ui === 'ar' ? 'أفقي' : 'landscape') : (ui === 'ar' ? 'عمودي' : 'portrait')}{PRESETS[ty].sides === 2 ? (ui === 'ar' ? ' · وجهان' : ' · 2 sides') : ''}</div>
                </button>
              ))}</div>
            </div>
            <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <legend className="mb-1 text-sm font-extrabold text-indigo-900">{ui === 'ar' ? 'البيانات التعليمية' : 'Lesson'}</legend>
              <Field label={t('lang')}><select className="input" value={form.lang} onChange={(e) => set('lang', e.target.value as EduSettings['lang'])}><option value="ar">عربي</option><option value="en">English</option><option value="bi">{ui === 'ar' ? 'ثنائي اللغة' : 'Bilingual'}</option></select></Field>
              <div className="sm:col-span-2"><Group label={t('subject')}>
                <Chips items={SUBJECTS.map((x) => ({ v: form.lang === 'en' ? x.en : x.ar, l: ui === 'ar' ? x.ar : x.en }))} value={form.subject ?? ''} onPick={(v) => setForm((f) => ({ ...f, subject: v, lesson: f.subject === v ? f.lesson : '' }))} />
                <input className="input mt-2" required maxLength={80} value={form.subject} onChange={(e) => set('subject', e.target.value)} placeholder={ui === 'ar' ? 'أو اكتب مادة أخرى' : 'or type another subject'} />
              </Group></div>
              <div className="sm:col-span-2"><Group label={t('grade')}>
                <Chips items={GRADES.map((g, i) => ({ v: form.lang === 'en' ? GRADES_EN[i] : g, l: ui === 'ar' ? g.replace('الصف ', '') : GRADES_EN[i] }))} value={form.grade ?? ''} onPick={(v) => set('grade', v)} />
                <input className="input mt-2" required maxLength={40} value={form.grade} onChange={(e) => set('grade', e.target.value)} placeholder={ui === 'ar' ? 'أو اكتب الصف' : 'or type the grade'} />
              </Group></div>
              <div className="sm:col-span-2"><Group label={t('lesson')}>
                <input className="input" required maxLength={160} value={form.lesson} onChange={(e) => set('lesson', e.target.value)} placeholder={ui === 'ar' ? 'اكتب عنوان الدرس أو اختر من الاقتراحات' : 'type the lesson or pick a suggestion'} />
                {(() => {
                  const official = officialLessons(curriculum.curriculum, form.subject ?? '', form.grade ?? '');
                  const ideas = lessonIdeas(form.subject ?? '', form.grade ?? '').filter((x) => !official.includes(x));
                  const st = stageOf(form.grade ?? '');
                  return <>
                    {official.length > 0 && <><div className="mt-2 flex items-center gap-1 text-[11px] font-bold text-emerald-700">📘 {ui === 'ar' ? `دروس كتاب الطالب ${curriculum.curriculumYear}` : `Textbook lessons ${curriculum.curriculumYear}`}</div><Chips items={official.map((x) => ({ v: x, l: x }))} value={form.lesson ?? ''} onPick={(v) => set('lesson', v)} /></>}
                    {ideas.length > 0 && <><div className="mt-2 text-[11px] font-bold text-slate-500">{ui === 'ar' ? `اقتراحات عامة${st ? ` — ${STAGE_AR[st]}` : ''} (ليست القائمة الرسمية)` : `General ideas${st ? ` — ${st}` : ''} (not the official list)`}</div><Chips items={ideas.map((x) => ({ v: x, l: x }))} value={form.lesson ?? ''} onPick={(v) => set('lesson', v)} /></>}
                    {!official.length && form.subject && gradeIndex(form.grade ?? '') !== null && <p className="mt-1 text-[11px] text-slate-400">{ui === 'ar' ? 'لا توجد قائمة رسمية مُدخلة لهذه المادة والصف — يضيفها المسؤول من «الإعدادات» من فهرس كتاب الطالب.' : 'No official list entered for this subject and grade yet (Settings).'}</p>}
                  </>;
                })()}
              </Group></div>
              <div className="sm:col-span-2"><Field label={t('objectives')}><textarea className="input" rows={2} maxLength={800} value={form.objectives} onChange={(e) => set('objectives', e.target.value)} /></Field></div>
              {has('student') && <Field label={t('student')}><input className="input" maxLength={80} value={form.student} onChange={(e) => set('student', e.target.value)} /></Field>}
              {has('student') && <Field label={t('classSection')}><input className="input" maxLength={40} value={form.classSection} onChange={(e) => set('classSection', e.target.value)} /></Field>}
              {(has('school') || has('student')) && <Field label={t('school')}><input className="input" maxLength={120} value={form.school} onChange={(e) => set('school', e.target.value)} /></Field>}
            </fieldset>
            <fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <legend className="mb-1 text-sm font-extrabold text-indigo-900">{ui === 'ar' ? 'إعدادات التصميم' : 'Design'}</legend>
              <Field label={t('size')}><select className="input" value={form.size} onChange={(e) => set('size', e.target.value as EduSettings['size'])}>{['A4', 'A3', 'A5', 'custom'].map((x) => <option key={x} value={x}>{x === 'custom' ? (ui === 'ar' ? 'مخصص' : 'Custom') : x}</option>)}</select></Field>
              {form.size === 'custom' && <Field label="mm"><div className="flex gap-1"><input className="input ltr" inputMode="numeric" placeholder="W" value={form.customMm?.w ?? ''} onChange={(e) => set('customMm', { w: Number(e.target.value) || 0, h: form.customMm?.h ?? 297 })} /><input className="input ltr" inputMode="numeric" placeholder="H" value={form.customMm?.h ?? ''} onChange={(e) => set('customMm', { h: Number(e.target.value) || 0, w: form.customMm?.w ?? 210 })} /></div></Field>}
              <Field label={t('orientation')}><select className="input" value={form.orientation} onChange={(e) => set('orientation', e.target.value as EduSettings['orientation'])}><option value="portrait">{ui === 'ar' ? 'عمودي' : 'Portrait'}</option><option value="landscape">{ui === 'ar' ? 'أفقي' : 'Landscape'}</option></select></Field>
              {(has('sides') || form.type === 'flashcards') && <Field label={t('sides')}><select className="input" value={form.sides} onChange={(e) => set('sides', Number(e.target.value) as 1 | 2)}><option value={1}>{ui === 'ar' ? 'وجه واحد' : 'Single'}</option><option value={2}>{ui === 'ar' ? 'وجهان' : 'Double'}</option></select></Field>}
              {(has('columns') || preset.engine === 'cards') && <Field label={t('columns')}><select className="input" value={form.columns} onChange={(e) => set('columns', Number(e.target.value))}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>}
              <Field label={t('style')}><select className="input" value={form.style} onChange={(e) => set('style', e.target.value as EduSettings['style'])}>{STYLES.map((x) => <option key={x} value={x}>{ui === 'ar' ? STYLE_AR[x] : x.replace('_', ' ')}</option>)}</select></Field>
              <Field label={t('detail')}><select className="input" value={form.detail} onChange={(e) => set('detail', e.target.value as EduSettings['detail'])}><option value="short">{ui === 'ar' ? 'مختصر' : 'Short'}</option><option value="medium">{ui === 'ar' ? 'متوسط' : 'Medium'}</option><option value="detailed">{ui === 'ar' ? 'مفصّل' : 'Detailed'}</option></select></Field>
              {has('images') && <Field label={t('images')}><select className="input" value={form.images} onChange={(e) => set('images', e.target.value as EduSettings['images'])}><option value="none">{ui === 'ar' ? 'بدون صور' : 'None'}</option><option value="low">{ui === 'ar' ? 'رسم واحد للغلاف' : 'One cover illustration'}</option><option value="medium">{ui === 'ar' ? 'متوسط: غلاف أعلى جودة + صور المعالم' : 'Medium: better cover + picture grids'}</option><option value="rich">{ui === 'ar' ? 'غني: غلاف + صور المعالم + رسم لكل قسم' : 'Rich: cover + grids + one per section'}</option></select></Field>}
              {has('images') && form.images !== 'none' && <div className="col-span-2 sm:col-span-3"><Group label={ui === 'ar' ? 'شخصية على الغلاف' : 'Cover character'}><Chips value={form.coverCharacter ?? 'none'} onPick={(v) => set('coverCharacter', v as EduSettings['coverCharacter'])} items={[{ v: 'none', l: ui === 'ar' ? 'بدون' : 'None' }, { v: 'boy', l: ui === 'ar' ? '👦 طالب بحريني' : '👦 Bahraini boy' }, { v: 'girl', l: ui === 'ar' ? '👧 طالبة بحرينية' : '👧 Bahraini girl' }]} /></Group><p className="mt-1 text-[11px] text-slate-500">{ui === 'ar' ? 'رسم ثلاثي الأبعاد بالزي البحريني، وعمره حسب الصف. لا تُرسم شخصيات في التربية الإسلامية.' : 'A 3D character in Bahraini dress, age from the grade. Never for Islamic studies.'}</p></div>}
              {(form.images === 'medium' || form.images === 'rich') && <div className="col-span-2 sm:col-span-3"><Group label={ui === 'ar' ? 'صور المعارض (المعالم والأشياء)' : 'Gallery pictures'}><Chips value={form.galleryStyle ?? 'auto'} onPick={(v) => set('galleryStyle', v as EduSettings['galleryStyle'])} items={[{ v: 'auto', l: ui === 'ar' ? 'تلقائي' : 'Auto' }, { v: 'photo', l: ui === 'ar' ? '📷 صور واقعية' : '📷 Realistic photos' }, { v: 'illustration', l: ui === 'ar' ? '🎨 رسوم بنفس الأسلوب' : '🎨 Illustrations' }]} /></Group><p className="mt-1 text-[11px] text-slate-500">{ui === 'ar' ? 'تلقائي = صور واقعية في الأسلوب اللامع. معالم البحرين المعروفة تُوصف بدقة (الشكل والخامة والمكان) حتى لا يخترع النموذج شكلها.' : 'Auto = realistic photos in the glossy style; known Bahrain landmarks are described accurately.'}</p></div>}
              <label className="col-span-2 flex items-start gap-2 rounded-lg border border-indigo-200 bg-indigo-50 p-2 text-xs sm:col-span-3"><input type="checkbox" className="mt-0.5" checked={!!form.aiBackground} onChange={(e) => set('aiBackground', e.target.checked)} /><span><b>{ui === 'ar' ? '🎨 خلفية فنية بالذكاء الاصطناعي لكل وجه' : '🎨 AI artwork behind every face'}</b> — {ui === 'ar' ? 'لوحة مرسومة حسب الدرس والنمط، والنص فوقها في بطاقات واضحة. النصوص والأرقام تبقى دقيقة (لا تُرسم داخل الصور).' : 'painted for the lesson and style; text stays exact on clear cards.'}</span></label>
              <Field label={t('fontScale')}><label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={form.autoFit !== false} onChange={(e) => set('autoFit', e.target.checked)} />{ui === 'ar' ? 'تلقائي — يملأ الصفحة' : 'Auto-fit'}</label>{form.autoFit === false && <input type="range" min={0.8} max={1.4} step={0.05} value={form.fontScale} onChange={(e) => set('fontScale', Number(e.target.value))} className="w-full" />}</Field>
              <Field label={t('digits')}><select className="input" value={form.digits} onChange={(e) => set('digits', e.target.value as EduSettings['digits'])}><option value="arabic">٠١٢٣٤٥٦٧٨٩</option><option value="latin">0123456789</option></select></Field>
              <Field label={t('equationDir')}><select className="input" value={form.equationDir} onChange={(e) => set('equationDir', e.target.value as EduSettings['equationDir'])}><option value="rtl">{ui === 'ar' ? 'من اليمين (٣ + ٤ = ٧)' : 'Right-to-left'}</option><option value="ltr">{ui === 'ar' ? 'من اليسار (3 + 4 = 7)' : 'Left-to-right'}</option></select></Field>
              {(has('exercises') || preset.engine === 'worksheet') && <Field label={t('exerciseCount')}><input className="input ltr" type="number" min={0} max={30} value={form.exerciseCount} onChange={(e) => set('exerciseCount', Number(e.target.value))} /></Field>}
              {has('cards') && <Field label={t('cardCount')}><input className="input ltr" type="number" min={2} max={24} value={form.cardCount} onChange={(e) => set('cardCount', Number(e.target.value))} /></Field>}
              <Field label={t('marginMm')}><input className="input ltr" type="number" min={5} max={25} value={form.marginMm} onChange={(e) => set('marginMm', Number(e.target.value))} /></Field>
              <Field label={t('bleedMm')}><select className="input" value={form.bleedMm} onChange={(e) => set('bleedMm', Number(e.target.value))}><option value={0}>0</option><option value={3}>3</option></select></Field>
              {preset.engine === 'worksheet' && <label className="col-span-2 flex items-center gap-2 text-sm sm:col-span-1"><input type="checkbox" checked={!!form.answerKey} onChange={(e) => set('answerKey', e.target.checked)} />{t('answerKey')}</label>}
            </fieldset>
            <div><div className="label mb-1">{t('palette')}</div><div className="flex flex-wrap gap-2">{PALETTES.map(([k, hex]) => <button key={k} type="button" aria-label={k} onClick={() => set('palette', k)} className={`h-9 w-9 rounded-full border-4 ${form.palette === k ? 'border-slate-900' : 'border-white'} shadow`} style={{ background: hex }} />)}</div></div>
            <Button variant="gold" size="lg" disabled={!!busy} onClick={createAndGenerate}>{busy ? t('working') : `✨ ${t('create')}`}</Button>
            <p className="text-xs text-slate-500">{ui === 'ar' ? 'المشاريع المدرسية بدون شعار المطبعة أو أرقام أو إعلانات أو علامة مائية، ولا يُضاف أي اسم طالب لم تكتبه.' : 'School projects never carry the print shop logo, phone numbers, ads or watermarks.'}</p>
          </section>
          <StepsPanel steps={steps} ui={ui} t={t} />
        </div>
      )}

      {tab === 'mine' && (
        <section className="rounded-2xl border bg-white p-4">
          {!rows.length ? <p className="text-sm text-slate-500">{t('noProjects')}</p> : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{rows.map((r) => (
              <article key={r.id} className="rounded-xl border p-3">
                <div className="flex items-start justify-between gap-2"><b className="text-indigo-900">{r.title}</b>{r.qc && <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${BADGE[r.qc.status]}`}>{r.qc.status}</span>}</div>
                <div className="text-xs text-slate-500">{ui === 'ar' ? PRESETS[r.type]?.ar : PRESETS[r.type]?.en} · {new Date(r.updatedAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}{r.source === 'sample' ? (ui === 'ar' ? ' · محتوى نموذجي' : ' · sample') : ''}</div>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => openProject(r.id)}>{t('open')}</Button>
                  <Button size="sm" variant="danger" onClick={async () => { if (!window.confirm(ui === 'ar' ? 'حذف المشروع وملفاته نهائيًا؟' : 'Delete the project and its files?')) return; await run('delete', async () => { await apiCall(`/api/edu/projects/${r.id}`, { method: 'DELETE' }); await refreshList(); if (proj?.id === r.id) { setProj(null); setPages([]); } toast(ui === 'ar' ? 'حُذف ✓' : 'Deleted ✓'); }); }}>{t('del')}</Button>
                </div>
              </article>
            ))}</div>
          )}
        </section>
      )}

      {tab === 'templates' && (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{TEMPLATES.map((tp) => (
          <article key={tp.ar} className="rounded-2xl border bg-white p-3">
            <div className="text-xs font-bold text-indigo-700">{ui === 'ar' ? PRESETS[tp.s.type].ar : PRESETS[tp.s.type].en}</div>
            <b className="block text-sm text-slate-900">{ui === 'ar' ? tp.ar : tp.en}</b>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => { setForm({ ...blank(tp.s.type), ...tp.s }); setTab('new'); }}>{t('useTemplate')}</Button>
          </article>
        ))}</section>
      )}

      {tab === 'preview' && proj && (
        <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
          <section className="min-w-0 space-y-3 rounded-2xl border bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              {pages.map((p, i) => <button key={i} type="button" onClick={() => setPage(i)} className={`rounded-full border px-3 py-1 text-xs font-bold ${page === i ? 'border-indigo-700 bg-indigo-700 text-white' : 'bg-white'}`}>{p.label}</button>)}
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={showFolds} onChange={(e) => setShowFolds(e.target.checked)} />{t('folds')}</label>
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={showSafe} onChange={(e) => setShowSafe(e.target.checked)} />{t('safe')}</label>
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={compare} disabled={!prevPages.length || prevPages === pages} onChange={(e) => setCompare(e.target.checked)} />{t('compare')}</label>
              <label className="flex items-center gap-1 text-xs">{t('zoom')} <input type="range" min={40} max={200} step={10} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /> <span className="ltr">{zoom}%</span></label>
            </div>
            {!cur ? <p className="p-6 text-center text-sm text-slate-500">{busy ? t('working') : (ui === 'ar' ? 'لا توجد معاينة بعد — أنشئ المحتوى أولًا.' : 'No preview yet.')}</p> : (
              <div className="overflow-auto rounded-xl bg-slate-200 p-3" style={{ maxHeight: '78vh' }}>
                <div className="relative mx-auto shadow-lg" style={{ width: `${zoom}%`, maxWidth: zoom > 100 ? 'none' : '100%' }}>
                  <img src={`/api/media/${cur.key}?v=${cur.v}`} alt={cur.label} className="block w-full bg-white" />
                  <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${cur.widthPx} ${cur.heightPx}`} preserveAspectRatio="none">
                    {showFolds && cur.folds.map((x) => <line key={x} x1={x} y1={0} x2={x} y2={cur.heightPx} stroke="#e11d48" strokeWidth={2} strokeDasharray="10 8" />)}
                    {showSafe && cur.regions.map((r) => <rect key={r.id} x={r.safe.x} y={r.safe.y} width={r.safe.w} height={r.safe.h} fill="none" stroke="#0ea5e9" strokeWidth={2} strokeDasharray="6 6" />)}
                    {cur.bleedMm > 0 && showSafe && <rect x={(cur.bleedMm * cur.dpi) / 25.4} y={(cur.bleedMm * cur.dpi) / 25.4} width={cur.widthPx - (2 * cur.bleedMm * cur.dpi) / 25.4} height={cur.heightPx - (2 * cur.bleedMm * cur.dpi) / 25.4} fill="none" stroke="#a855f7" strokeWidth={2} />}
                  </svg>
                </div>
              </div>
            )}
            {cur && <p className="text-[11px] text-slate-500"><span dir="ltr">{cur.trimMm.w} × {cur.trimMm.h} mm{cur.bleedMm ? ` + ${cur.bleedMm} mm bleed` : ''}</span> · {ui === 'ar' ? 'المعاينة بنفس محرك ملفات الطباعة' : 'same engine as the print files'}{compare ? (ui === 'ar' ? ' · تعرض النسخة السابقة' : ' · showing previous version') : ''}{fit ? ` · ${ui === 'ar' ? 'الخط' : 'text'} ${Math.round(fit.fontScale * 100)}%${proj.settings.autoFit !== false ? (ui === 'ar' ? ' (تلقائي)' : ' (auto)') : ''} · ${ui === 'ar' ? STYLE_AR[fit.style as keyof typeof STYLE_AR] ?? fit.style : fit.style}` : ''}</p>}
            {panelOrder && proj.type === 'brochure' && (
              <div className="rounded-xl bg-slate-50 p-3 text-xs">
                <b>{ui === 'ar' ? 'ترتيب الأعمدة حسب طريقة الطي' : 'Panel order (fold)'}</b>
                {pages.slice(0, 2).map((p, side) => (
                  <div key={side} className="mt-2 flex flex-wrap items-center gap-1.5"><span className="w-28 font-bold">{p.label}</span>
                    {p.regions.map((r, i) => <span key={r.id} className="flex items-center gap-1"><span className="rounded-lg border bg-white px-2 py-1">{r.label}</span>{i < 2 && <button type="button" className="rounded border bg-white px-1.5" title="swap" disabled={!!busy} onClick={() => swapPanel(side, i, i + 1)}>⇄</button>}</span>)}
                  </div>
                ))}
                <p className="mt-2 text-slate-500">{ui === 'ar' ? 'الترتيب من اليسار إلى اليمين على الورقة. فحص الجودة يتحقق أن الغلاف الأمامي يكون في الأعلى بعد الطي.' : 'Left to right on the sheet. QC checks the front cover ends up on top after folding.'}</p>
              </div>
            )}
          </section>
          <aside className="space-y-3">
            <div className="rounded-2xl border bg-white p-3">
              <div className="mb-2 flex flex-wrap gap-2">
                <Button size="sm" variant="gold" disabled={!!busy || !draft} onClick={() => saveDraft()}>{t('save')}</Button>
                <Button size="sm" variant="outline" disabled={!!busy || !(proj.versions?.length)} onClick={() => run('undo', async () => { await apiCall(`/api/edu/projects/${proj.id}/undo`, { method: 'POST' }); await loadPreview(proj.id); toast(ui === 'ar' ? 'تم التراجع ✓' : 'Undone ✓'); })}>{t('undo')}</Button>
              </div>
              <div className="mb-2 flex flex-wrap items-center gap-1.5">{PALETTES.map(([k, hex]) => <button key={k} type="button" aria-label={k} disabled={!!busy} onClick={() => saveDraft(ui === 'ar' ? 'تغيير الألوان' : 'Colours', { palette: k })} className={`h-7 w-7 rounded-full border-2 ${proj.settings.palette === k ? 'border-slate-900' : 'border-white'} shadow`} style={{ background: hex }} />)}
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={proj.settings.autoFit !== false} disabled={!!busy} onChange={(e) => saveDraft(ui === 'ar' ? 'ملء الصفحة تلقائيًا' : 'Auto-fit', { autoFit: e.target.checked })} />{ui === 'ar' ? 'خط تلقائي يملأ الصفحة' : 'Auto-fit text'}</label>
                <select className="input !w-auto !py-1 text-xs" value={proj.settings.fontScale} disabled={!!busy || proj.settings.autoFit !== false} title={ui === 'ar' ? 'حجم يدوي (أوقف التلقائي أولًا)' : 'Manual size'} onChange={(e) => saveDraft(ui === 'ar' ? 'حجم الخط' : 'Font size', { fontScale: Number(e.target.value), autoFit: false })}>{[0.85, 0.9, 1, 1.1, 1.2, 1.3, 1.4].map((v) => <option key={v} value={v}>{Math.round(v * 100)}%</option>)}</select>
                <select className="input !w-auto !py-1 text-xs" value={proj.settings.style} disabled={!!busy} onChange={(e) => saveDraft(ui === 'ar' ? 'تغيير النمط' : 'Style', { style: e.target.value as EduSettings['style'] })}>{STYLES.map((x) => <option key={x} value={x}>{ui === 'ar' ? STYLE_AR[x] : x.replace('_', ' ')}</option>)}</select>
                <select className="input !w-auto !py-1 text-xs" value={proj.settings.digits} disabled={!!busy} onChange={(e) => saveDraft(t('digits'), { digits: e.target.value as EduSettings['digits'] })}><option value="arabic">٠١٢</option><option value="latin">012</option></select>
              </div>
              {draft && <ContentEditor draft={draft} setDraft={setDraft} ui={ui} t={t} busy={!!busy} onRewrite={(sid) => run('rewrite', async () => { await apiCall(`/api/edu/projects/${proj.id}/section`, { body: { sectionId: sid } }); await loadPreview(proj.id); toast(ui === 'ar' ? 'أُعيدت كتابة القسم ✓' : 'Section rewritten ✓'); })} aiLive={aiLive} />}
            </div>
            <section className="rounded-2xl border border-indigo-200 bg-gradient-to-b from-indigo-50 to-white p-3">
              <b className="text-sm text-indigo-900">🎨 {ui === 'ar' ? 'الرسومات بالذكاء الاصطناعي' : 'AI artwork'}</b>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <select className="input !w-auto !py-1 text-xs" value={proj.settings.images} disabled={!!busy} onChange={(e) => saveDraft(ui === 'ar' ? 'مستوى الصور' : 'Images', { images: e.target.value as EduSettings['images'] })}><option value="none">{ui === 'ar' ? 'بدون صور' : 'None'}</option><option value="low">{ui === 'ar' ? 'غلاف' : 'Cover'}</option><option value="medium">{ui === 'ar' ? 'غلاف بجودة أعلى' : 'Cover HQ'}</option><option value="rich">{ui === 'ar' ? 'غني: رسم لكل قسم' : 'Rich'}</option></select>
                <label className="flex items-center gap-1"><input type="checkbox" checked={!!proj.settings.aiBackground} disabled={!!busy} onChange={(e) => saveDraft(ui === 'ar' ? 'خلفية فنية' : 'AI background', { aiBackground: e.target.checked })} />{ui === 'ar' ? 'خلفية فنية لكل وجه' : 'Background per face'}</label>
              </div>
              {plan && plan.slots.length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs">{plan.slots.map((sl) => (
                  <li key={sl.id} className="flex items-center justify-between gap-2"><span className="min-w-0 flex-1 truncate">{sl.done ? '✅' : '⏳'} {sl.label}</span>{sl.done && plan.live && <button type="button" disabled={!!busy} className="shrink-0 text-indigo-700 underline disabled:text-slate-400" onClick={() => makeImages(proj.id, [sl.id])}>{ui === 'ar' ? 'تغيير' : 'Redo'}</button>}</li>
                ))}</ul>
              ) : <p className="mt-2 text-xs text-slate-500">{ui === 'ar' ? 'اختر مستوى الصور أو الخلفية الفنية.' : 'Choose images or a background.'}</p>}
              {plan && plan.missing > 0 && (plan.live
                ? <Button size="sm" variant="gold" className="mt-2" disabled={!!busy} onClick={() => makeImages(proj.id)}>{ui === 'ar' ? `توليد ${plan.missing} صورة` : `Generate ${plan.missing}`} <span className="ltr">(~${plan.costUsd})</span></Button>
                : <p className="mt-2 text-xs text-amber-700">{ui === 'ar' ? 'توليد الصور يحتاج مفتاح OpenAI — غير متاح في وضع التجربة.' : 'Needs an OpenAI key (dry-run).'}</p>)}
              <p className="mt-2 text-[11px] text-slate-500">{ui === 'ar' ? 'الصور بلا أي نص أو أرقام داخلها؛ العناوين والمعادلات طبقات حقيقية. للتربية الإسلامية: زخارف ومساجد وكتب فقط، بلا أشخاص.' : 'No text inside pictures; titles and equations stay real text.'}</p>
            </section>
            <QcPanel qc={qc} t={t} />
            <StepsPanel steps={steps} ui={ui} t={t} />
          </aside>
        </div>
      )}

      {tab === 'export' && proj && (
        <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
          <section className="min-w-0 space-y-3 rounded-2xl border bg-white p-4">
            <div className="flex flex-wrap gap-3 text-sm">{(['pdf', 'png', 'jpg'] as const).map((f) => <label key={f} className="flex items-center gap-1"><input type="checkbox" checked={formats.includes(f)} onChange={(e) => setFormats((x) => (e.target.checked ? [...x, f] : x.filter((y) => y !== f)))} />{f.toUpperCase()}{f === 'pdf' ? (ui === 'ar' ? ' (كل الصفحات)' : ' (all pages)') : (ui === 'ar' ? ' (ملف لكل وجه)' : ' (one per page)')}</label>)}</div>
            <Button variant="gold" disabled={!!busy || !formats.length} onClick={() => run('export', async () => { const r = await apiCall<{ files: { kind: string; name: string; key: string; bytes: number }[]; qc: Qc }>(`/api/edu/projects/${proj.id}/export`, { body: { formats } }); setQc(r.qc); const pr = await apiCall<{ project: Project }>(`/api/edu/projects/${proj.id}`); setProj(pr.project); toast(ui === 'ar' ? 'أُنشئت الملفات وفُحصت ✓' : 'Files created and checked ✓'); })}>{t('exportBtn')}</Button>
            {qc?.printReady ? <p className="rounded-lg bg-emerald-50 p-2 text-sm font-bold text-emerald-800">✅ {ui === 'ar' ? 'جاهز للطباعة — اجتاز الفحوص المنفذة (RGB، طباعة رقمية/مكتبية)' : 'Print-ready — passed the checks that ran (RGB, digital/office print)'}</p>
              : proj.exports && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-800">{ui === 'ar' ? 'لم تكتمل شروط «جاهز للطباعة» — راجع فحص الجودة.' : 'Not marked print-ready — see quality control.'}</p>}
            {proj.exports?.files?.length ? (
              <ul className="divide-y rounded-xl border">{proj.exports.files.map((f) => (
                <li key={f.key} className="flex items-center justify-between gap-2 p-2 text-sm"><span className="min-w-0 flex-1 truncate"><b className="uppercase">{f.kind}</b> · {f.name} <span className="text-xs text-slate-500">({Math.round(f.bytes / 1024)} KB)</span></span><a className="shrink-0 rounded-lg bg-indigo-700 px-3 py-1 text-xs font-bold text-white" href={`/api/media/${f.key}`} download={f.name}>{ui === 'ar' ? 'تنزيل' : 'Download'}</a></li>
              ))}</ul>
            ) : <p className="text-sm text-slate-500">{ui === 'ar' ? 'لم تُنشأ ملفات بعد.' : 'No files yet.'}</p>}
            <p className="text-xs text-slate-500">{ui === 'ar' ? 'كل صفحة تُرسم بدقة 300 DPI بالمقاس الدقيق بالمليمتر؛ ملف PDF يحتوي الصفحات نفسها (مطابقة للمعاينة). الألوان RGB — للطباعة الأوفست التجارية تحتاج تحويل CMYK/ICC من المطبعة.' : 'Pages are drawn at 300 DPI at the exact size; the PDF holds the same pages (matches the preview). Colours are RGB — offset printing needs a CMYK/ICC conversion.'}</p>
          </section>
          <QcPanel qc={qc} t={t} />
        </div>
      )}

      {tab === 'settings' && <CurriculumEditor ui={ui} canAdmin={canAdmin} curriculum={curriculum} onSaved={setCurriculum} />}
      {tab === 'settings' && (
        <section className="space-y-3 rounded-2xl border bg-white p-4 text-sm">
          <Field label={ui === 'ar' ? 'لغة الواجهة' : 'Interface language'}><select className="input" value={ui} onChange={(e) => setUi(e.target.value as Lang)}><option value="ar">العربية (RTL)</option><option value="en">English (LTR)</option></select></Field>
          <ul className="list-inside list-disc space-y-1 text-slate-600">
            <li>{ui === 'ar' ? 'الخط: Cairo (عربي وإنجليزي) — مرخّص OFL ومضمّن في الصفحات المرسومة.' : 'Font: Cairo (Arabic + Latin), OFL licensed, rendered into the pages.'}</li>
            <li>{ui === 'ar' ? 'المقاسات: A3 ‏297×420 · A4 ‏210×297 · A5 ‏148×210 مم، أو مقاس مخصص.' : 'Sizes: A3, A4, A5 or custom (mm).'}</li>
            <li>{ui === 'ar' ? 'الهامش الآمن ونزيف الطباعة (3 مم) يُضبطان لكل مشروع من «مشروع جديد».' : 'Safe margin and 3 mm bleed are set per project.'}</li>
            <li>{ui === 'ar' ? 'الذكاء الاصطناعي: يستخدم مفتاح OpenAI المحفوظ في «إعدادات الذكاء الاصطناعي» على الخادم (لا يظهر في المتصفح). بدونه يُنشأ محتوى نموذجي واضح.' : 'AI uses the server-side OpenAI key from AI settings; without it a clearly-labelled sample is made.'}</li>
          </ul>
        </section>
      )}
    </div>
  );
}

/** a labelled group for chips + input (a <label> must not wrap several buttons) */
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return <div role="group" aria-label={label} className="block"><span className="label">{label}</span>{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="label">{label}</span>{children}</label>;
}

function StepsPanel({ steps, ui, t }: { steps: StepState[]; ui: Lang; t: (k: string) => string }) {
  const map = new Map(steps.map((s) => [s.id, s]));
  return (
    <section className="rounded-2xl border bg-white p-3">
      <b className="text-sm text-indigo-900">{t('steps')}</b>
      <ol className="mt-2 space-y-1">{STEPS.map((id, i) => { const s = map.get(id); const st = s?.status ?? 'pending'; return (
        <li key={id} className="flex items-start gap-2 text-xs"><span className="w-5 shrink-0 text-slate-400">{i + 1}</span><span className="flex-1"><b>{STEP_AR[id][ui === 'ar' ? 0 : 1]}</b>{s?.note && <span className="block text-[11px] text-slate-500">{s.note}</span>}</span><span className={`rounded-full px-2 py-0.5 font-bold ${BADGE[st]}`}>{st}</span></li>
      ); })}</ol>
    </section>
  );
}

function QcPanel({ qc, t }: { qc: Qc | null; t: (k: string) => string }) {
  if (!qc) return null;
  return (
    <section className="rounded-2xl border bg-white p-3">
      <div className="mb-2 flex items-center justify-between"><b className="text-sm text-indigo-900">{t('qc')}</b><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${BADGE[qc.status]}`}>{qc.status}</span></div>
      <ul className="space-y-1.5">{qc.checks.map((c) => (
        <li key={c.id} className="text-xs"><span className={`me-1 rounded px-1.5 py-0.5 font-bold ${BADGE[c.status]}`}>{c.status}</span>{c.label}{c.detail && <div className="ms-12 text-[11px] text-slate-500">{c.detail}</div>}</li>
      ))}</ul>
    </section>
  );
}

function ContentEditor({ draft, setDraft, ui, t, busy, onRewrite, aiLive }: { draft: EduContent; setDraft: (c: EduContent) => void; ui: Lang; t: (k: string) => string; busy: boolean; onRewrite: (id: string) => void; aiLive: boolean }) {
  const up = (p: Partial<EduContent>) => setDraft({ ...draft, ...p });
  const lines = (v: string) => v.split('\n').map((x) => x.trim()).filter(Boolean);
  const sec = useMemo(() => draft.sections, [draft.sections]);
  const [added, setAdded] = useState<string | null>(null);
  const upSec = (i: number, p: Partial<EduContent['sections'][number]>) => up({ sections: sec.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  return (
    <div className="max-h-[60vh] space-y-3 overflow-y-auto pe-1">
      <label className="block"><span className="label">{ui === 'ar' ? 'العنوان' : 'Title'}</span><input className="input" maxLength={140} value={draft.title} onChange={(e) => up({ title: e.target.value })} /></label>
      <label className="block"><span className="label">{ui === 'ar' ? 'المقدمة' : 'Intro'}</span><textarea className="input" rows={2} maxLength={800} value={draft.intro} onChange={(e) => up({ intro: e.target.value })} /></label>
      <label className="block"><span className="label">{ui === 'ar' ? 'أهداف التعلم (سطر لكل هدف)' : 'Objectives (one per line)'}</span><textarea className="input" rows={3} value={draft.objectives.join('\n')} onChange={(e) => up({ objectives: lines(e.target.value).slice(0, 8) })} /></label>
      {sec.map((s, i) => (
        <details key={s.id} className="rounded-xl border p-2" open={i === 0 || s.id === added}>
          <summary className="cursor-pointer text-sm font-bold text-indigo-900">{s.heading || `#${i + 1}`}</summary>
          <div className="mt-2 space-y-2">
            <input className="input" maxLength={120} value={s.heading} onChange={(e) => upSec(i, { heading: e.target.value })} />
            <textarea className="input" rows={2} maxLength={1200} placeholder={ui === 'ar' ? 'الشرح' : 'Body'} value={s.body} onChange={(e) => upSec(i, { body: e.target.value })} />
            <textarea className="input" rows={2} placeholder={ui === 'ar' ? 'نقاط (سطر لكل نقطة)' : 'Bullets'} value={s.bullets.join('\n')} onChange={(e) => upSec(i, { bullets: lines(e.target.value).slice(0, 10) })} />
            <div className="space-y-1">{s.exercises.map((ex, j) => (
              <div key={j} className="grid grid-cols-[1fr_80px_28px] gap-1"><input className="input text-xs" value={ex.q} placeholder={ui === 'ar' ? 'السؤال: مثل 23 + 15 = __' : 'Question e.g. 23 + 15 = __'} onChange={(e) => upSec(i, { exercises: s.exercises.map((x, k) => (k === j ? { ...x, q: e.target.value } : x)) })} /><input className="input ltr text-xs" placeholder={ui === 'ar' ? 'الإجابة' : 'Answer'} value={ex.answer} onChange={(e) => upSec(i, { exercises: s.exercises.map((x, k) => (k === j ? { ...x, answer: e.target.value } : x)) })} /><button type="button" aria-label="remove" className="rounded border text-red-600" onClick={() => upSec(i, { exercises: s.exercises.filter((_, k) => k !== j) })}>✕</button></div>
            ))}
              {s.exercises.length < 30 && <button type="button" className="text-xs font-bold text-indigo-700 underline" onClick={() => upSec(i, { exercises: [...s.exercises, { q: '', answer: '', kind: 'text', choices: [] }] })}>+ {ui === 'ar' ? 'تمرين' : 'Exercise'}</button>}
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs">
              <button type="button" disabled={i === 0} className="rounded border px-2 py-0.5 disabled:opacity-40" onClick={() => { const a = [...sec]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; up({ sections: a }); }}>↑ {ui === 'ar' ? 'أعلى' : 'Up'}</button>
              <button type="button" disabled={i === sec.length - 1} className="rounded border px-2 py-0.5 disabled:opacity-40" onClick={() => { const a = [...sec]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; up({ sections: a }); }}>↓ {ui === 'ar' ? 'أسفل' : 'Down'}</button>
              <button type="button" className="rounded border px-2 py-0.5 text-red-700" onClick={() => { if (window.confirm(ui === 'ar' ? `حذف القسم «${s.heading}»؟` : 'Delete this section?')) up({ sections: sec.filter((_, k) => k !== i) }); }}>🗑 {ui === 'ar' ? 'حذف القسم' : 'Delete'}</button>
            </div>
            <button type="button" disabled={busy || !aiLive} title={aiLive ? '' : (ui === 'ar' ? 'يحتاج مفتاح OpenAI' : 'Needs an OpenAI key')} className="text-xs font-bold text-indigo-700 underline disabled:text-slate-400 disabled:no-underline" onClick={() => onRewrite(s.id)}>↻ {t('rewrite')}{aiLive ? '' : (ui === 'ar' ? ' (غير متاح — وضع التجربة)' : ' (unavailable — dry-run)')}</button>
          </div>
        </details>
      ))}
      {sec.length < 12 && <button type="button" className="w-full rounded-xl border-2 border-dashed p-2 text-sm font-bold text-indigo-700" onClick={() => { const id = `s${Date.now().toString(36)}`; setAdded(id); up({ sections: [...sec, { id, heading: ui === 'ar' ? 'قسم جديد' : 'New section', body: '', bullets: [], examples: [], exercises: [], image: '', gallery: [] }] }); }}>+ {ui === 'ar' ? 'إضافة قسم' : 'Add section'}</button>}
      <label className="block"><span className="label">{ui === 'ar' ? 'الملخص (سطر لكل نقطة)' : 'Summary'}</span><textarea className="input" rows={3} value={draft.summary.join('\n')} onChange={(e) => up({ summary: lines(e.target.value).slice(0, 8) })} /></label>
      {draft.cards.length > 0 && <label className="block"><span className="label">{ui === 'ar' ? 'البطاقات (أمام | خلف)' : 'Cards (front | back)'}</span><textarea className="input ltr" rows={4} value={draft.cards.map((c) => `${c.front} | ${c.back}`).join('\n')} onChange={(e) => up({ cards: lines(e.target.value).slice(0, 24).map((l) => { const [f, b] = l.split('|'); return { front: (f ?? '').trim(), back: (b ?? '').trim() }; }) })} /></label>}
    </div>
  );
}

/** quick-pick chips (the field next to them still accepts free text) */
function Chips({ items, value, onPick }: { items: { v: string; l: string }[]; value: string; onPick: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">{items.map((x) => (
      <button key={x.v} type="button" aria-pressed={value === x.v} onClick={() => onPick(x.v)} className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${value === x.v ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-700 active:bg-indigo-50'}`}>{x.l}</button>
    ))}</div>
  );
}

/** «منهج البحرين للسنة الحالية»: the official lesson list per subject + grade, typed once from the textbook contents */
function CurriculumEditor({ ui, canAdmin, curriculum, onSaved }: { ui: Lang; canAdmin: boolean; curriculum: { curriculumYear: string; curriculum: CurriculumEntry[] }; onSaved: (c: { curriculumYear: string; curriculum: CurriculumEntry[] }) => void }) {
  const [subject, setSubject] = useState<string>(SUBJECTS[0].ar);
  const [grade, setGrade] = useState(4);
  const [year, setYear] = useState(curriculum.curriculumYear);
  const cur = curriculum.curriculum.find((e) => e.subject === subject && e.grade === grade);
  const [text, setText] = useState(cur?.lessons.join('\n') ?? '');
  const [source, setSource] = useState(cur?.source ?? '');
  const [msg, setMsg] = useState('');
  useEffect(() => { const e = curriculum.curriculum.find((x) => x.subject === subject && x.grade === grade); setText(e?.lessons.join('\n') ?? ''); setSource(e?.source ?? ''); setMsg(''); }, [subject, grade, curriculum]);
  const save = async () => {
    try {
      const r = await apiCall<{ curriculumYear: string; curriculum: CurriculumEntry[] }>('/api/edu/curriculum', { method: 'PUT', body: { subject, grade, lessons: text.split('\n').map((s) => s.replace(/^[\s\d٠-٩.\-–•)]+/, '').trim()).filter(Boolean), source: source || undefined, curriculumYear: year } });
      onSaved({ curriculumYear: r.curriculumYear, curriculum: r.curriculum }); setMsg(ui === 'ar' ? 'حُفظت القائمة ✓ — تظهر أولًا في «عنوان الدرس»' : 'Saved ✓');
    } catch (e) { setMsg((e as Error).message); }
  };
  const done = curriculum.curriculum.length;
  return (
    <section className="space-y-3 rounded-2xl border bg-white p-4 text-sm">
      <div className="font-extrabold text-indigo-900">📘 {ui === 'ar' ? `دروس منهج البحرين ${curriculum.curriculumYear} (من كتاب الطالب)` : `Bahrain textbook lessons ${curriculum.curriculumYear}`}</div>
      <p className="text-xs text-slate-600">{ui === 'ar' ? 'انسخ عناوين الدروس من فهرس كتاب الطالب لهذه السنة (سطر لكل درس). تظهر لكل المستخدمين أولًا عند اختيار المادة والصف. لا يضع النظام قائمة «رسمية» من عنده.' : 'Copy the lesson titles from this year\u2019s textbook contents (one per line).'} {done ? (ui === 'ar' ? `· مُدخل حاليًا: ${done} مادة/صف` : `· entered: ${done}`) : ''}</p>
      {!canAdmin ? <p className="rounded bg-slate-50 p-2 text-xs text-slate-600">{ui === 'ar' ? 'الإدخال للمسؤول فقط.' : 'Admins only.'}</p> : <>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="text-xs font-bold">{ui === 'ar' ? 'المادة' : 'Subject'}<select className="input mt-1" value={subject} onChange={(e) => setSubject(e.target.value)}>{SUBJECTS.map((s) => <option key={s.ar} value={s.ar}>{ui === 'ar' ? s.ar : s.en}</option>)}</select></label>
          <label className="text-xs font-bold">{ui === 'ar' ? 'الصف' : 'Grade'}<select className="input mt-1" value={grade} onChange={(e) => setGrade(Number(e.target.value))}>{GRADES.map((g, i) => <option key={g} value={i}>{ui === 'ar' ? g : GRADES_EN[i]}{curriculum.curriculum.some((x) => x.subject === subject && x.grade === i) ? ' ✓' : ''}</option>)}</select></label>
          <label className="text-xs font-bold">{ui === 'ar' ? 'السنة الدراسية' : 'School year'}<input className="input ltr mt-1" value={year} maxLength={20} onChange={(e) => setYear(e.target.value)} /></label>
        </div>
        <textarea className="input" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={ui === 'ar' ? 'الدرس الأول\nالدرس الثاني\n…' : 'Lesson 1\nLesson 2'} />
        <input className="input text-xs" value={source} maxLength={200} onChange={(e) => setSource(e.target.value)} placeholder={ui === 'ar' ? 'المصدر (مثال: كتاب الطالب — الفصل الأول)' : 'Source (e.g. student book, term 1)'} />
        <div className="flex flex-wrap items-center gap-2"><button type="button" onClick={save} className="rounded-lg bg-indigo-700 px-4 py-2 text-xs font-bold text-white">{ui === 'ar' ? 'حفظ القائمة' : 'Save list'}</button>{msg && <span className="text-xs font-bold text-emerald-700">{msg}</span>}</div>
      </>}
      {canAdmin && <BulkImport ui={ui} year={year} onSaved={onSaved} />}
      <a href="/api/edu/curriculum/import" download className="inline-block text-xs font-bold text-indigo-700 underline">{ui === 'ar' ? 'تنزيل كل القوائم المحفوظة (ملف نصي قابل للتعديل)' : 'Download all saved lists'}</a>
    </section>
  );
}

/** all subjects and grades at once: «# المادة | الصف» + lessons, or CSV «المادة,الصف,الدرس»; preview before saving */
function BulkImport({ ui, year, onSaved }: { ui: Lang; year: string; onSaved: (c: { curriculumYear: string; curriculum: CurriculumEntry[] }) => void }) {
  const [text, setText] = useState('');
  const [pv, setPv] = useState<{ preview: { subject: string; grade: number; lessons: number }[]; errors: string[] } | null>(null);
  const [msg, setMsg] = useState('');
  const run = async (save: boolean) => {
    try {
      const r = await apiCall<{ preview?: { subject: string; grade: number; lessons: number }[]; errors: string[]; curriculumYear?: string; curriculum?: CurriculumEntry[]; imported?: number }>('/api/edu/curriculum/import', { method: 'POST', body: { text, save, curriculumYear: year } });
      if (save && r.curriculum) { onSaved({ curriculumYear: r.curriculumYear ?? year, curriculum: r.curriculum }); setMsg(ui === 'ar' ? `حُفظت ${r.imported} قائمة ✓` : `Saved ${r.imported} lists ✓`); setPv(null); }
      else setPv({ preview: r.preview ?? [], errors: r.errors });
    } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <div className="space-y-2 rounded-xl border border-dashed border-indigo-300 bg-indigo-50/40 p-3">
      <div className="text-xs font-extrabold text-indigo-900">{ui === 'ar' ? 'إدخال جماعي — كل المواد والصفوف دفعة واحدة' : 'Bulk import — all subjects and grades'}</div>
      <pre className="whitespace-pre-wrap rounded bg-white p-2 font-sans text-[11px] text-slate-600" dir="rtl">{'# اللغة العربية | الصف الرابع\nالدرس الأول\nالدرس الثاني\n\n# الرياضيات | الصف الثالث\nالدرس الأول\n…'}</pre>
      <p className="text-[11px] text-slate-500">{ui === 'ar' ? 'أو ملف CSV بأعمدة: المادة، الصف، الدرس. كل مادة/صف في الملف يستبدل قائمته المحفوظة فقط.' : 'Or CSV: subject, grade, lesson.'}</p>
      <input type="file" accept=".txt,.csv,text/plain,text/csv" className="block w-full text-xs" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setText(await f.text()); setPv(null); } }} />
      <textarea className="input text-xs" rows={6} value={text} onChange={(e) => { setText(e.target.value); setPv(null); }} placeholder={ui === 'ar' ? 'الصق النص هنا' : 'Paste here'} />
      <div className="flex flex-wrap gap-2"><button type="button" disabled={!text.trim()} onClick={() => run(false)} className="rounded-lg border bg-white px-3 py-1.5 text-xs font-bold">{ui === 'ar' ? 'معاينة' : 'Preview'}</button>
        <button type="button" disabled={!pv || !pv.preview.length} onClick={() => run(true)} className="rounded-lg bg-indigo-700 px-3 py-1.5 text-xs font-bold text-white disabled:bg-slate-300">{ui === 'ar' ? 'حفظ الكل' : 'Save all'}</button>{msg && <span className="text-xs font-bold text-emerald-700">{msg}</span>}</div>
      {pv && <div className="text-xs">
        <div className="font-bold">{ui === 'ar' ? `${pv.preview.length} قائمة · ${pv.preview.reduce((a, x) => a + x.lessons, 0)} درسًا` : `${pv.preview.length} lists`}</div>
        <ul className="mt-1 grid grid-cols-1 gap-0.5 sm:grid-cols-2">{pv.preview.map((x) => <li key={`${x.subject}${x.grade}`}>• {x.subject} — {GRADES[x.grade]}: {x.lessons}</li>)}</ul>
        {pv.errors.length > 0 && <ul className="mt-1 space-y-0.5 rounded bg-amber-50 p-2 text-amber-900">{pv.errors.map((er, i) => <li key={i}>{er}</li>)}</ul>}
      </div>}
    </div>
  );
}

