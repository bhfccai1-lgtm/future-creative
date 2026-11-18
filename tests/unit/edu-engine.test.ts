import { describe, expect, it } from 'vitest';
import { arithmeticDrill, checkStatement, evaluate, toArabicDigits, toLatinDigits, tokenize, visualOrder } from '@/lib/edu/math';
import { buildPdf, inspectPdf } from '@/lib/edu/pdf';
import { defaultPanelOrder, foldCheck, paperMm, renderDoc } from '@/lib/edu/render';
import { fixAnswerKeys, normalizeContent, sampleContent } from '@/lib/edu/content';
import { EDU_TYPES, PRESETS, SettingsSchema } from '@/lib/edu/types';
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
    expect(resolveStyle(SettingsSchema.parse({ ...base, type: 'poster', grade: 'الصف الثاني' }))).toBe('kids_cartoon');
    expect(resolveStyle(SettingsSchema.parse({ ...base, type: 'poster', grade: 'الصف الخامس' }))).toBe('school_colorful');
    expect(resolveStyle(SettingsSchema.parse({ ...base, type: 'poster', grade: 'Grade 9' }))).toBe('creative');
    expect(resolveStyle(SettingsSchema.parse({ ...base, type: 'certificate', grade: 'الصف الثاني' }))).toBe('luxury');
    expect(resolveStyle(SettingsSchema.parse({ ...base, type: 'poster', grade: 'الصف الثاني', style: 'minimal' }))).toBe('minimal');
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
