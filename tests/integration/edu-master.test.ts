import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { setAiProviderOverride } from '@/lib/ai';
import { storage } from '@/lib/storage';
import { createProject, exportFiles, generate, preview, undo, updateProject } from '@/lib/edu/service';
import { inspectPdf } from '@/lib/edu/pdf';
import { ContentSchema } from '@/lib/edu/types';
import { captureQueues, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });

/** A test double for the text model: returns a fixed, correct lesson so the pipeline (not the model) is under test. */
class EduAi extends FakeAiProvider {
  constructor(private reply: unknown) { super(); }
  async generateJson() { return { json: this.reply, usage: { inputTokens: 100, outputTokens: 400 }, model: 'test-model' }; }
}
const iman = {
  title: 'أركان الإيمان', subtitle: 'التربية الإسلامية · الصف الرابع', intro: 'الإيمان هو التصديق بالقلب والقول باللسان والعمل بالجوارح.',
  objectives: ['أعدّد أركان الإيمان الستة.', 'أوضح معنى الإيمان.', 'أذكر دليلًا على أركان الإيمان.'],
  sections: [
    { id: 's1', heading: 'الإيمان بالله', body: 'أن نؤمن بأن الله واحد لا شريك له، خالق كل شيء.', bullets: [], examples: [], exercises: [], image: '' },
    { id: 's2', heading: 'الإيمان بالملائكة', body: 'مخلوقات من نور يطيعون الله ولا يعصونه.', bullets: [], examples: [], exercises: [], image: '' },
    { id: 's3', heading: 'الإيمان بالكتب', body: 'التوراة والزبور والإنجيل والقرآن الكريم.', bullets: [], examples: [], exercises: [], image: '' },
    { id: 's4', heading: 'الإيمان بالرسل', body: 'أرسلهم الله لهداية الناس، وخاتمهم محمد ﷺ.', bullets: [], examples: [], exercises: [], image: '' },
    { id: 's5', heading: 'الإيمان باليوم الآخر', body: 'يوم يبعث الله الناس ويحاسبهم على أعمالهم.', bullets: [], examples: [], exercises: [], image: '' },
    { id: 's6', heading: 'الإيمان بالقدر', body: 'أن كل ما يحدث بعلم الله وتقديره، خيره وشره.', bullets: [], examples: [], exercises: [], image: '' },
  ],
  summary: ['أركان الإيمان ستة.', 'دليلها حديث جبريل عليه السلام.'],
};
const worksheet = { title: 'الجمع والطرح', subtitle: 'ورقة عمل', intro: '', objectives: [], summary: [], sections: [{ id: 's1', heading: 'احسب', body: '', bullets: [], examples: [], image: '',
  exercises: [{ q: '34 + 25 = __', answer: '59', kind: 'equation', choices: [] }, { q: '81 − 47 = __', answer: '35', kind: 'equation', choices: [] }, { q: '60 + 18 = __', answer: '78', kind: 'equation', choices: [] }, { q: 'اكتب عددًا أكبر من ٤٥', answer: '', kind: 'text', choices: [] }] }] };

describe('EDUCATION MASTER AI — acceptance projects', () => {
  it('1) math brochure, grade 3, A4 landscape, 2 sides × 3 panels: separate faces, Arabic order, equations, PDF + images', async () => {
    const { admin } = await seedBase(); // dry-run: computed sample content (no AI key)
    const user = { sub: admin.id, email: admin.email, perms: ['ads:create'] };
    const p = await createProject({ type: 'brochure', subject: 'الرياضيات', grade: 'الصف الثالث', lesson: 'الجمع والطرح', lang: 'ar' }, user);
    expect(p.settings).toMatchObject({ size: 'A4', orientation: 'landscape', sides: 2, columns: 3 });
    const g = await generate(p.id, user);
    expect(g.source).toBe('sample');
    const pv = await preview(p.id, user);
    expect(pv.pages).toHaveLength(2);
    expect(pv.pages[0].regions.map((r) => r.id)).toEqual(['front', 'back', 'flap']); // Arabic: front cover on the left, back in the middle
    expect(pv.pages[1].regions.map((r) => r.id)).toEqual(['in3', 'in2', 'in1']); // inside reads right → left
    expect(pv.pages[0].folds).toHaveLength(2);
    const { files, qc } = await exportFiles(p.id, ['pdf', 'png', 'jpg'], user);
    const byId = Object.fromEntries(qc.checks.map((c) => [c.id, c.status]));
    expect(byId).toMatchObject({ math: 'PASS', text_fit: 'PASS', overlap: 'PASS', safe_area: 'PASS', fold_order: 'PASS', sides: 'PASS', dimensions: 'PASS', pdf: 'PASS', image_files: 'PASS', identity: 'PASS' });
    expect(qc.checks.find((c) => c.id === 'facts')?.status).toBe('WARNING'); // facts are never auto-«passed»
    const pdf = await storage().get(files.find((f) => f.kind === 'pdf')!.key);
    const info = inspectPdf(pdf);
    expect(info.ok).toBe(true);
    expect(info.pages).toEqual([{ wMm: 297, hMm: 210 }, { wMm: 297, hMm: 210 }]);
    const png = files.filter((f) => f.kind === 'png');
    expect(png).toHaveLength(2);
    const meta = await sharp(await storage().get(png[0].key)).metadata();
    expect([meta.width, meta.height]).toEqual([3508, 2480]); // A4 landscape at 300 DPI
    expect(qc.checks.filter((c) => c.status === 'FAIL')).toEqual([]);
    expect(qc.printReady).toBe(true);
  }, 240000);

  it('2) Islamic studies poster «أركان الإيمان», grade 4, A4 landscape, one side', async () => {
    const { admin } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
    setAiProviderOverride(new EduAi(iman));
    const user = { sub: admin.id, email: admin.email, perms: ['ads:create'] };
    const p = await createProject({ type: 'poster', subject: 'التربية الإسلامية', grade: 'الصف الرابع', lesson: 'أركان الإيمان', orientation: 'landscape', images: 'none' }, user);
    const g = await generate(p.id, user);
    expect(g.source).toBe('ai');
    expect(ContentSchema.parse(g.content).sections).toHaveLength(6);
    const { files, qc } = await exportFiles(p.id, ['pdf', 'png'], user);
    expect(qc.checks.find((c) => c.id === 'text_fit')?.status).toBe('PASS');
    expect(qc.checks.find((c) => c.id === 'glyphs')?.status).toBe('PASS'); // «ﷺ» is written out, not a missing glyph
    expect(qc.printReady).toBe(true);
    expect(qc.checks.find((c) => c.id === 'pages')?.detail).toBe('1 صفحة');
    expect(inspectPdf(await storage().get(files.find((f) => f.kind === 'pdf')!.key)).pages).toEqual([{ wMm: 297, hMm: 210 }]);
    expect(await prisma.aiUsage.count()).toBe(1); // the text call is costed
  }, 240000);

  it('3) math worksheet with blank answer boxes: wrong AI answers are corrected by computation; answer-key page; edit + undo', async () => {
    const { admin } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
    const bad = JSON.parse(JSON.stringify(worksheet)); bad.sections[0].exercises[1].answer = '35'; // 81 − 47 is 34
    setAiProviderOverride(new EduAi(bad));
    const user = { sub: admin.id, email: admin.email, perms: ['ads:create'] };
    const p = await createProject({ type: 'worksheet', subject: 'الرياضيات', grade: 'الصف الثالث', lesson: 'الجمع والطرح', exerciseCount: 4, images: 'none', answerKey: true }, user);
    const g = await generate(p.id, user);
    const ex = ContentSchema.parse(g.content).sections[0].exercises;
    expect(ex[1].answer).toBe('34');
    expect((g.steps as { id: string; status: string }[]).find((s) => s.id === 'review')?.status).toBe('warning');
    const pv = await preview(p.id, user);
    expect(pv.pages.length).toBe(2); // the sheet + the answer key
    // a worked example with a wrong result is a FAIL (never silently «fixed»)
    const c = ContentSchema.parse(g.content);
    c.sections[0].examples = [{ problem: '12 + 9 = 20', steps: [], answer: '20' }];
    await updateProject(p.id, { content: c, note: 'test' }, user);
    const after = await preview(p.id, user);
    expect(after.qc.checks.find((x) => x.id === 'math')?.status).toBe('FAIL');
    await undo(p.id, user);
    const back = await preview(p.id, user);
    expect(back.qc.checks.find((x) => x.id === 'math')?.status).toBe('PASS');
  }, 240000);
});

describe('EDUCATION MASTER — AI artwork', () => {
  it('plans cover + 2 face backgrounds + one picture per section, generates them, places them, and redoes one', async () => {
    const { admin } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
    const ai = new EduAi(iman); setAiProviderOverride(ai);
    const user = { sub: admin.id, email: admin.email, perms: ['ads:create'] };
    const { imagePlan, generateImages } = await import('@/lib/edu/service');
    const p = await createProject({ type: 'brochure', subject: 'التربية الإسلامية', grade: 'الصف الرابع', lesson: 'أركان الإيمان', images: 'rich', aiBackground: true }, user);
    await generate(p.id, user);
    const plan = await imagePlan(p.id, user);
    expect(plan.slots.map((x) => x.id)).toEqual(['cover', 'bg:0', 'bg:1', 'sec:s1', 'sec:s2', 'sec:s3', 'sec:s4', 'sec:s5', 'sec:s6']);
    expect(plan.missing).toBe(9); expect(plan.costUsd).toBeGreaterThan(0);
    const r = await generateImages(p.id, user);
    expect(r).toMatchObject({ generated: 9, failed: [] });
    expect(ai.lastScenePrompt).toMatch(/NO text, letters, words, numbers/);
    expect(ai.lastScenePrompt).toMatch(/NEVER draw people, faces/); // Islamic studies rule
    // the cover was painted first and is the style reference of the other illustrations (one consistent brochure)
    expect(ai.lastReferences?.length).toBe(1);
    expect(ai.lastScenePrompt).toMatch(/reference image/);
    expect(await prisma.aiUsage.count({ where: { kind: 'image' } })).toBe(9);
    const pv = await preview(p.id, user);
    const imgs = pv.qc.checks.find((c) => c.id === 'image_quality');
    expect(imgs?.detail).toContain('الخلفية');
    const { files, qc } = await exportFiles(p.id, ['pdf'], user);
    expect(qc.checks.filter((c) => c.status === 'FAIL').map((c) => c.id)).toEqual([]);
    expect(inspectPdf(await storage().get(files[0].key)).pages).toHaveLength(2);
    // redo only the cover: a new file replaces the old one
    const before = (await prisma.eduProject.findUniqueOrThrow({ where: { id: p.id } })).images as Record<string, string>;
    await generateImages(p.id, user, { only: ['cover'] });
    const after = (await prisma.eduProject.findUniqueOrThrow({ where: { id: p.id } })).images as Record<string, string>;
    expect(after['bg:0']).toBe(before['bg:0']);
    expect(await storage().exists(after.cover)).toBe(true);
  }, 300000);
});
