import { describe, expect, it } from 'vitest';
import { arithmeticDrill, checkStatement, evaluate, toArabicDigits, toLatinDigits, tokenize, visualOrder } from '@/lib/edu/math';
import { buildPdf, inspectPdf } from '@/lib/edu/pdf';
import { defaultPanelOrder, foldCheck, paperMm, renderDoc } from '@/lib/edu/render';
import { fixAnswerKeys, normalizeContent, sampleContent } from '@/lib/edu/content';
import { EDU_TYPES, PRESETS, SettingsSchema, ContentSchema } from '@/lib/edu/types';
import { runQc } from '@/lib/edu/qc';
import sharp from 'sharp';

describe('EDUCATION MASTER — numbers & equations', () => {
  it('digits convert both ways; equations tokenise in either script', () => {
    expect(toArabicDigits('27 + 15 = 42')).toBe('٢٧ + ١٥ = ٤٢');
    expect(toLatinDigits('٢٧ + ١٥ = ٤٢')).toBe('27 + 15 = 42');
    expect(tokenize('٢٧ + ١٥ = __')).toEqual([{ t: 'num', v: '27' }, { t: 'op', v: '+' }, { t: 'num', v: '15' }, { t: 'op', v: '=' }, { t: 'blank' }]);
    expect(tokenize('اكتب عددًا')).toBeNull();
  });
  it('RTL visual order keeps numbers intact and puts the first operand on the right', () => {
    const v = visualOrder(tokenize('23 + 15 = 38')!, 'rtl').map((t) => (t.t === 'blank' ? '_' : t.v));
    expect(v).toEqual(['38', '=', '15', '+', '23']); // drawn left→right, read right→left: 23 + 15 = 38
    expect(visualOrder(tokenize('23 + 15 = 38')!, 'ltr').map((t) => (t.t === 'blank' ? '_' : t.v))).toEqual(['23', '+', '15', '=', '38']);
  });
  it('checks arithmetic with precedence and answers; drills are always correct', () => {
    expect(evaluate(tokenize('2 + 3 × 4')!)).toBe(14);
    expect(checkStatement('81 − 47 = 34')?.ok).toBe(true);
    expect(checkStatement('81 − 47 = 35')).toMatchObject({ ok: false, expected: 34 });
    expect(checkStatement('٩ × ٦ = __', '٥٤')?.ok).toBe(true);
    expect(checkStatement('نكتب ٢ ونحمل ١')).toBeNull();
    for (const d of arithmeticDrill(40, 3, 5)) { expect(checkStatement(d.q, d.answer)?.ok).toBe(true); expect(Number(d.answer)).toBeGreaterThanOrEqual(0); expect(Number(d.answer)).toBeLessThanOrEqual(100); }
  });
  it('wrong answer keys are corrected by computation, never left wrong', () => {
    const c = normalizeContent({ title: 't', sections: [{ id: 's1', heading: 'h', exercises: [{ q: '7 + 8 = __', answer: '16', kind: 'text' }] }] });
    expect(fixAnswerKeys(c)).toEqual(['7 + 8 = __: 16 → 15']);
    expect(c.sections[0].exercises[0]).toMatchObject({ answer: '15', kind: 'equation' });
  });
});

describe('EDUCATION MASTER — paper, folds, PDF', () => {
  it('paper sizes in mm with orientation', () => {
    expect(paperMm(SettingsSchema.parse({ type: 'brochure', subject: 'a', grade: 'b', lesson: 'cc', size: 'A4', orientation: 'landscape' }))).toEqual({ w: 297, h: 210 });
    expect(paperMm(SettingsSchema.parse({ type: 'poster', subject: 'a', grade: 'b', lesson: 'cc', size: 'A3', orientation: 'portrait' }))).toEqual({ w: 297, h: 420 });
  });
  it('brochure panel order: Arabic default and the fold check', () => {
    expect(defaultPanelOrder('ar')).toEqual([[0, 1, 2], [2, 1, 0]]);
    expect(defaultPanelOrder('en')).toEqual([[2, 1, 0], [0, 1, 2]]);
    expect(foldCheck([[0, 1, 2], [2, 1, 0]]).ok).toBe(true);
    expect(foldCheck([[1, 0, 2], [2, 1, 0]]).ok).toBe(false); // back cover not in the middle → front won't be on top
  });
  it('the PDF writer makes a valid file at exact mm sizes (with bleed boxes)', async () => {
    const jpeg = await sharp({ create: { width: 100, height: 140, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    const pdf = buildPdf([{ jpeg, widthPx: 100, heightPx: 140, trimMm: { w: 210, h: 297 }, bleedMm: 3 }, { jpeg, widthPx: 100, heightPx: 140, trimMm: { w: 210, h: 297 }, bleedMm: 3 }], { title: 'Test' });
    const r = inspectPdf(pdf);
    expect(r).toMatchObject({ ok: true, problems: [] });
    expect(r.pages).toEqual([{ wMm: 216, hMm: 303 }, { wMm: 216, hMm: 303 }]);
    expect(pdf.toString('latin1')).toContain('/TrimBox');
    expect(inspectPdf(pdf.subarray(0, pdf.length - 40)).ok).toBe(false);
  });
});

describe('EDUCATION MASTER — every design type renders and passes layout QC', () => {
  for (const type of EDU_TYPES) it(`${type} (${PRESETS[type].ar})`, async () => {
    const s = SettingsSchema.parse({ type, subject: 'الرياضيات', grade: 'الصف الثالث', lesson: 'الجمع والطرح', size: PRESETS[type].size, orientation: PRESETS[type].orientation, sides: PRESETS[type].sides, columns: PRESETS[type].columns });
    const c = sampleContent(s);
    const doc = await renderDoc(s, c, { dpi: 60 });
    expect(doc.pages.length).toBeGreaterThan(0);
    const qc = runQc(s, c, doc, { source: 'sample' });
    const fails = qc.checks.filter((x) => x.status === 'FAIL' && x.id !== 'placeholders').map((x) => `${x.id}: ${x.detail ?? ''}`);
    expect(fails).toEqual([]);
  }, 60000);
});

describe('EDUCATION MASTER — styles, auto-fit, balanced columns', () => {
  const base = { subject: 'العلوم', lesson: 'درس', size: 'A4' as const };
  it('smart style by grade and type', async () => {
    const { resolveStyle } = await import('@/lib/edu/render');
    // brochures and posters get the polished printed-brochure look; other designs follow the grade
    expect(resolveStyle(SettingsSchema.parse({ ...base, type: 'brochure', grade: 'الصف الرابع' }))).toBe('glossy');
    expect(resolveStyle(SettingsSchema.parse({ ...base, type: 'poster', grade: 'الصف الثاني' }))).toBe('glossy');
    expect(resolveStyle(SettingsSchema.parse({ ...base, type: 'worksheet', grade: 'الصف الثاني' }))).toBe('kids_cartoon');
    expect(resolveStyle(SettingsSchema.parse({ ...base, type: 'worksheet', grade: 'الصف الخامس' }))).toBe('school_colorful');
    expect(resolveStyle(SettingsSchema.parse({ ...base, type: 'worksheet', grade: 'Grade 9' }))).toBe('creative');
    expect(resolveStyle(SettingsSchema.parse({ ...base, type: 'certificate', grade: 'الصف الثاني' }))).toBe('luxury');
    expect(resolveStyle(SettingsSchema.parse({ ...base, type: 'poster', grade: 'الصف الثاني', style: 'minimal' }))).toBe('minimal');
  });
  it('glossy brochure: icon pills, cream cards, vocabulary table and picture grid pass layout QC', async () => {
    const { renderDoc, iconFor } = await import('@/lib/edu/render');
    const { runQc } = await import('@/lib/edu/qc');
    expect(iconFor('معاني المفردات', 0)).toBe('search');
    expect(iconFor('بعض معالم مملكة البحرين', 0)).toBe('pin');
    expect(iconFor('أفكار الدرس الرئيسية', 0)).toBe('target');
    const s = SettingsSchema.parse({ ...base, type: 'brochure', subject: 'اللغة العربية', grade: 'الصف الرابع', lesson: 'وطني', orientation: 'landscape' });
    const c = ContentSchema.parse({ title: 'وطني', intro: 'يتحدث الدرس عن حب الوطن.', objectives: ['أعبّر عن حبي لوطني.'], summary: ['الوطن بيتنا الكبير.'],
      sections: [
        { id: 's1', heading: 'أفكار الدرس الرئيسية', bullets: ['حب الوطن والاعتزاز به.', 'جمال مملكة البحرين وتنوع معالمها الكثيرة والجميلة.'] },
        { id: 's2', heading: 'معاني المفردات', table: { headers: ['الكلمة', 'معناها'], rows: [['معتزًا', 'فخورًا.'], ['الإرث', 'ما يُورث من الآباء والأجداد.']] } },
        { id: 's3', heading: 'بعض معالم مملكة البحرين', gallery: [{ caption: 'قلعة البحرين' }, { caption: 'المتحف الوطني' }, { caption: 'شجرة الحياة' }] },
      ] });
    const doc = await renderDoc(s, c, { dpi: 60 });
    expect(doc.pages).toHaveLength(2);
    const ids = doc.pages.flatMap((p) => p.placed.map((x) => x.id));
    expect(ids).toEqual(expect.arrayContaining(['subject', 'lesson_tag', 'title', 'name:0', 's2:tb:0:0', 's2:tb:2:1', 's3:gal0', 's3:gal2', 's1:head']));
    // the student line is never invented
    expect(doc.pages[0].placed.find((x) => x.id === 'name:0')?.text).toBe('');
    const qc = runQc(s, c, doc, { source: 'edited' });
    for (const id of ['text_fit', 'overlap', 'safe_area', 'glyphs']) expect(qc.checks.find((x) => x.id === id)?.status, id).toBe('PASS');
  });
  it('wrapped Arabic lines align to the right edge (Pango mirrors alignment for RTL paragraphs)', async () => {
    const sharp = (await import('sharp')).default;
    const { renderDoc } = await import('@/lib/edu/render');
    const s = SettingsSchema.parse({ ...base, type: 'poster', grade: 'الصف الخامس', style: 'minimal', autoFit: false, columns: 1 });
    const long = 'جمال مملكة البحرين وتنوع معالمها الكثيرة '.repeat(6) + 'نهاية';
    const doc = await renderDoc(s, ContentSchema.parse({ title: 'اختبار', intro: long }), { dpi: 60 });
    const intro = doc.pages[0].placed.find((x) => x.id === 'intro')!;
    // the ink of the LAST line must touch the right edge of the text block
    const { data, info } = await sharp(doc.pages[0].png).extract({ left: Math.round(intro.rect.x), top: Math.round(intro.rect.y + intro.rect.h - 12), width: Math.round(intro.rect.w), height: 10 }).greyscale().raw().toBuffer({ resolveWithObject: true });
    let maxx = 0; for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[y * info.width + x] < 128) maxx = Math.max(maxx, x);
    expect(maxx).toBeGreaterThan(info.width * 0.9);
  });
  it('auto-fit grows sparse text without overflow; manual size is respected', async () => {
    const s = SettingsSchema.parse({ ...base, type: 'poster', grade: 'الصف الرابع', orientation: 'landscape', columns: 3 });
    const c = normalizeContent({ title: 'قصير', sections: [{ id: 's1', heading: 'قسم', body: 'جملة واحدة.' }] });
    const auto = await renderDoc(s, c, { dpi: 50 });
    expect(auto.fontScale).toBeGreaterThan(1.2);
    expect(auto.pages.every((p) => p.placed.every((x) => x.fits))).toBe(true);
    const manual = await renderDoc({ ...s, autoFit: false, fontScale: 0.9 }, c, { dpi: 50 });
    expect(manual.fontScale).toBe(0.9);
  }, 60000);
  it('poster columns are balanced (no near-empty last column)', async () => {
    const s = SettingsSchema.parse({ ...base, type: 'poster', grade: 'الصف الرابع', orientation: 'landscape', columns: 3, autoFit: false });
    const c = normalizeContent({ title: 't', sections: Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, heading: `قسم ${i + 1}`, body: 'نص تعليمي قصير يشرح الفكرة الأساسية لهذا القسم.' })) });
    const d = await renderDoc(s, c, { dpi: 50 });
    const per = ['col1', 'col2', 'col3'].map((id) => d.pages[0].placed.filter((x) => x.region === id).length);
    expect(Math.min(...per)).toBeGreaterThan(0);
  }, 60000);
});

describe('EDUCATION MASTER — form choices', () => {
  it('lesson ideas follow the subject AND the school stage; the official list comes only from what was entered', async () => {
    const { SUBJECTS, GRADES, lessonIdeas, gradeIndex, stageOf, officialLessons } = await import('@/lib/edu/choices');
    expect(SUBJECTS.map((x) => x.ar)).toEqual(expect.arrayContaining(['اللغة العربية', 'الرياضيات', 'العلوم', 'التربية الإسلامية']));
    expect(GRADES).toHaveLength(13);
    expect(gradeIndex('الصف الرابع')).toBe(4); expect(gradeIndex('الصف الثاني عشر')).toBe(12); expect(gradeIndex('الصف الحادي عشر')).toBe(11); expect(gradeIndex('Grade 7')).toBe(7); expect(gradeIndex('رياض الأطفال')).toBe(0); expect(gradeIndex('٣')).toBe(3);
    expect(stageOf('الصف الثاني')).toBe('lower'); expect(stageOf('الصف الخامس')).toBe('upper'); expect(stageOf('الصف الثامن')).toBe('intermediate'); expect(stageOf('الصف العاشر')).toBe('secondary');
    expect(lessonIdeas('الرياضيات', 'الصف الثالث')).toContain('الجمع والطرح');
    expect(lessonIdeas('الرياضيات', 'الصف الحادي عشر')).not.toContain('الجمع والطرح');
    expect(lessonIdeas('اللغة العربية', 'الصف الرابع')).toContain('وطني');
    expect(lessonIdeas('Science', '')).toContain('أجزاء النبات'); expect(lessonIdeas('Science', 'الصف الخامس')).toContain('دورة الماء في الطبيعة');
    expect(lessonIdeas('مادة غير معروفة', 'الصف الرابع')).toEqual([]);
    const entries = [{ subject: 'اللغة العربية', grade: 4, lessons: ['درس من الكتاب ١', 'درس من الكتاب ٢'] }];
    expect(officialLessons(entries, 'اللغة العربية', 'الصف الرابع')).toEqual(['درس من الكتاب ١', 'درس من الكتاب ٢']);
    expect(officialLessons(entries, 'اللغة العربية', 'الصف الخامس')).toEqual([]);
    expect(officialLessons([], 'الرياضيات', 'الصف الرابع')).toEqual([]);
  });
});

describe('EDUCATION MASTER — curriculum bulk import', () => {
  it('reads headings and CSV, strips numbering, reports unknown subjects/grades, round-trips the export', async () => {
    const { parseCurriculumText, curriculumToText } = await import('@/lib/edu/choices');
    const r = parseCurriculumText(['// تعليق', '# اللغة العربية | الصف الرابع', '1. وطني', '2- أمي الحبيبة', '• وطني', '', '# الرياضيات - الصف الثالث', '١) الجمع', 'العلوم,الصف الخامس,دورة الماء', '"Science";"Grade 5";"السلسلة الغذائية"', 'الفلك,الصف الأول,شيء', '# الرياضيات | الصف العشرون', 'درس'].join('\n'));
    const ar4 = r.entries.find((e) => e.subject === 'اللغة العربية' && e.grade === 4)!;
    expect(ar4.lessons).toEqual(['وطني', 'أمي الحبيبة']);
    expect(r.entries.find((e) => e.subject === 'الرياضيات' && e.grade === 3)?.lessons).toEqual(['الجمع']);
    expect(r.entries.find((e) => e.subject === 'العلوم' && e.grade === 5)?.lessons).toEqual(['دورة الماء', 'السلسلة الغذائية']);
    expect(r.errors.join(' ')).toContain('العشرون');
    const back = parseCurriculumText(curriculumToText(r.entries, '2026-2027'));
    expect(back.errors).toEqual([]); expect(back.entries).toEqual(expect.arrayContaining(r.entries));
  });
});

