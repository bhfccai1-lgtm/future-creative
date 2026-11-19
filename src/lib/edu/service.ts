import crypto from 'node:crypto';
import sharp from 'sharp';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { audit } from '../audit';
import { AppError } from '../errors';
import { storage } from '../storage';
import { getSettings } from '../settings';
import { getAiProvider } from '../ai';
import { assertBudget, estimateImageCost } from '../ai/cost';
import { ContentSchema, PRESETS, SettingsSchema, STEPS, type StepId, type StepState } from './types';
import { generateContent, regenerateSection } from './content';
import { renderDoc, defaultPanelOrder, resolveStyle } from './render';
import { buildPdf, inspectPdf } from './pdf';
import { plannedSlots } from './art';
import { generateChecked, qualitySummary } from '../creative/checked-image';
import { runQc, type EduQc } from './qc';

type User = { sub: string; email: string; perms: readonly string[] };
const MAX_VERSIONS = 15;
const freshSteps = (): StepState[] => STEPS.map((id) => ({ id, status: 'pending' }));

export async function loadProject(id: string, user: User) {
  const p = await prisma.eduProject.findUnique({ where: { id } });
  if (!p || (p.createdBy !== user.email && !user.perms.includes('users:manage'))) throw new AppError('NOT_FOUND', 'المشروع غير موجود.', 404);
  return p;
}
const settingsOf = (p: { settings: unknown }) => SettingsSchema.parse(p.settings);
const contentOf = (p: { content: unknown }) => (p.content ? ContentSchema.parse(p.content) : null);
const stepsOf = (p: { steps: unknown }) => ((p.steps as StepState[] | null) ?? freshSteps());
function mark(steps: StepState[], id: StepId, status: StepState['status'], note?: string) {
  return steps.map((s) => (s.id === id ? { ...s, status, note, at: new Date().toISOString() } : s));
}

/** STEP 1–2: input + validation (preset sizes for the type unless the user chose otherwise). */
export async function createProject(input: unknown, user: User) {
  const raw = (input ?? {}) as Record<string, unknown>;
  const type = SettingsSchema.shape.type.parse(raw.type);
  const pr = PRESETS[type];
  const parsed = SettingsSchema.safeParse({ size: pr.size, orientation: pr.orientation, sides: pr.sides, columns: pr.columns, ...raw });
  if (!parsed.success) throw new AppError('INVALID', `بيانات ناقصة: ${parsed.error.issues.map((i) => i.path.join('.')).join('، ')}`, 422);
  const s = parsed.data;
  let steps = mark(freshSteps(), 'input', 'done');
  steps = mark(steps, 'validate', 'done', `${pr.ar} · ${s.size} ${s.orientation === 'landscape' ? 'أفقي' : 'عمودي'} · ${s.sides === 2 ? 'وجهان' : 'وجه واحد'}`);
  const p = await prisma.eduProject.create({ data: { title: s.lesson, type: s.type, settings: s as unknown as Prisma.InputJsonValue, steps: steps as unknown as Prisma.InputJsonValue, createdBy: user.email } });
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'edu.create', targetType: 'edu_project', targetId: p.id, details: { type: s.type } });
  return p;
}

async function snapshot(p: { versions: unknown; content: unknown; settings: unknown }, note: string) {
  const v = ((p.versions as unknown[] | null) ?? []).slice(-(MAX_VERSIONS - 1));
  return [...v, { at: new Date().toISOString(), content: p.content ?? null, settings: p.settings, note }] as unknown as Prisma.InputJsonValue;
}

/** STEP 3–6: lesson analysis + content + review (+ the cover illustration when images are on and a real image model is configured). */
export async function generate(id: string, user: User) {
  const p = await loadProject(id, user);
  const s = settingsOf(p);
  let steps = mark(stepsOf(p), 'plan', 'running');
  await prisma.eduProject.update({ where: { id }, data: { steps: steps as unknown as Prisma.InputJsonValue } });
  try {
    const g = await generateContent(s);
    steps = mark(mark(steps, 'plan', 'done', `${s.subject} · ${s.grade}`), 'content', 'done', g.source === 'ai' ? `ذكاء اصطناعي (${g.model})` : 'محتوى نموذجي — لا يوجد مفتاح ذكاء اصطناعي');
    steps = mark(steps, 'review', g.fixes.length ? 'warning' : 'done', g.fixes.length ? `صُحّح مفتاح الإجابة آليًا: ${g.fixes.length}` : 'تحقق آلي من العمليات الحسابية');
    const slots = plannedSlots(s, g.content);
    steps = mark(steps, 'images', slots.length ? 'pending' : 'skipped', slots.length ? `${slots.length} صورة بانتظار التوليد` : 'بدون صور (حسب الإعداد)');
    const upd = await prisma.eduProject.update({ where: { id }, data: { title: g.content.title || p.title, content: g.content as unknown as Prisma.InputJsonValue, source: g.source, steps: steps as unknown as Prisma.InputJsonValue, versions: await snapshot(p, 'قبل إنشاء المحتوى') } });
    await audit({ actorId: user.sub, actorLabel: user.email, action: 'edu.generate', targetType: 'edu_project', targetId: id, details: { source: g.source, fixes: g.fixes.length } });
    return upd;
  } catch (e) {
    steps = mark(steps, 'content', 'failed', (e as Error).message.slice(0, 200));
    await prisma.eduProject.update({ where: { id }, data: { steps: steps as unknown as Prisma.InputJsonValue } });
    throw e;
  }
}

/** The images this project would generate, with the estimated cost (shown before anything is paid for). */
export async function imagePlan(id: string, user: User) {
  const p = await loadProject(id, user);
  const s = settingsOf(p), c = contentOf(p);
  const settings = await getSettings();
  const have = (p.images as Record<string, string> | null) ?? {};
  const slots = c ? plannedSlots(s, c) : [];
  const quality = s.images === 'medium' || s.images === 'rich' ? 'medium' : 'low';
  const missing = slots.filter((x) => !have[x.id]);
  const live = !(await getAiProvider(settings)).isDryRun;
  return { slots: slots.map((x) => ({ id: x.id, label: x.label, kind: x.kind, done: !!have[x.id] })), missing: missing.length, quality, costUsd: Math.round(estimateImageCost(settings, quality, missing.length) * 1000) / 1000, live };
}

/**
 * STEP 6: AI artwork — generates the missing slots (or `only` the given ones again), 3 at a time, within the
 * monthly AI budget. Each picture is checked to be a real image before it is kept. Text is never inside them.
 */
export async function generateImages(id: string, user: User, opts: { only?: string[] } = {}) {
  const p = await loadProject(id, user);
  const s = settingsOf(p), c = contentOf(p);
  if (!c) throw new AppError('NO_CONTENT', 'أنشئ المحتوى أولًا.', 409);
  const settings = await getSettings();
  const provider = await getAiProvider(settings);
  if (provider.isDryRun) throw new AppError('NO_AI', 'توليد الصور يحتاج مفتاح OpenAI (وضع التجربة مفعّل).', 412);
  const have = { ...((p.images as Record<string, string> | null) ?? {}) };
  const all = plannedSlots(s, c);
  const todo = all.filter((x) => (opts.only ? opts.only.includes(x.id) : !have[x.id]));
  if (!todo.length) return { project: p, generated: 0, failed: [] as string[] };
  const quality = s.images === 'medium' || s.images === 'rich' ? 'medium' : 'low';
  await assertBudget(settings, estimateImageCost(settings, quality, todo.length));
  let steps = mark(stepsOf(p), 'images', 'running', `${todo.length} صورة…`);
  await prisma.eduProject.update({ where: { id }, data: { steps: steps as unknown as Prisma.InputJsonValue } });
  const failed: string[] = []; const flagged: string[] = []; let generated = 0, retried = 0;
  // the cover is painted first and becomes the STYLE REFERENCE of the other illustrations (palette, light, finish),
  // so the whole brochure looks like one piece; realistic gallery photos do not follow the cartoon reference
  let styleRef: Buffer | null = null;
  const cover = todo.find((x) => x.kind === 'cover');
  const queue = cover ? todo.filter((x) => x !== cover) : [...todo];
  const photoSlot = (x: (typeof todo)[number]) => x.kind === 'gallery' && /photograph/.test(x.prompt);
  const paint = async (slot: (typeof todo)[number]) => {
      try {
        const ref = styleRef && slot.kind !== 'cover' && !photoSlot(slot) ? [styleRef] : undefined;
        const prompt = ref ? `${slot.prompt} Match the colour palette, lighting and rendering style of the reference image exactly (it is the cover of the same brochure); draw a NEW picture of the subject described above, do not copy the reference.` : slot.prompt;
        // quality gate: no text inside (lessons are printed by the engine), not soft — one automatic retry on failure
        const img = await generateChecked(provider, settings, prompt, { model: settings.ai.imageModel, quality, size: slot.size, seedHint: `${id}:${slot.id}:${Date.now()}`, ...(ref ? { references: ref } : {}) });
        if (slot.kind === 'cover') styleRef = await sharp(img.png).resize(768, 768, { fit: 'inside' }).png().toBuffer();
        const meta = await sharp(img.png).metadata();
        if (!meta.width || !meta.height) throw new Error('صورة غير صالحة');
        have[`q:${slot.id}`] = qualitySummary(img.quality, { attempts: img.attempts });
        if (img.attempts > 1) retried++;
        if (!img.quality.pass) flagged.push(`${slot.label}: ${img.quality.issues.filter((i) => i.level === 'fail').map((i) => i.ar).join('، ')}`);
        const key = `edu/${id}/img-${slot.id.replace(/[^a-z0-9]+/gi, '-')}-${crypto.createHash('sha256').update(img.png).digest('hex').slice(0, 10)}.png`;
        await storage().put(key, img.png, 'image/png');
        if (have[slot.id]) await storage().remove(have[slot.id]).catch(() => undefined);
        have[slot.id] = key; generated++;
      } catch (e) { failed.push(`${slot.label}: ${(e as Error).message.slice(0, 100)}`); }
  };
  if (cover) await paint(cover);
  else if (have.cover) { try { styleRef = await sharp(await storage().get(have.cover)).resize(768, 768, { fit: 'inside' }).png().toBuffer(); } catch { styleRef = null; } }
  const worker = async () => { for (let slot = queue.shift(); slot; slot = queue.shift()) await paint(slot); };
  await Promise.all([worker(), worker(), worker()]);
  const gate = `${retried ? ` · أُعيد توليد ${retried} لفشلها في فحص الجودة` : ''}${flagged.length ? ` · تحتاج مراجعة: ${flagged[0]}` : ''}`;
  steps = mark(steps, 'images', failed.length || flagged.length ? (generated ? 'warning' : 'failed') : 'done', failed.length ? `تم ${generated} — تعذّر ${failed.length}: ${failed[0]}${gate}` : `${generated} صورة بالذكاء الاصطناعي — فُحصت (بلا نصوص، حادة)${gate}`);
  const upd = await prisma.eduProject.update({ where: { id }, data: { images: have as unknown as Prisma.InputJsonValue, steps: steps as unknown as Prisma.InputJsonValue, versions: await snapshot(p, 'قبل توليد الصور') } });
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'edu.images', targetType: 'edu_project', targetId: id, details: { generated, failed: failed.length, retried, flagged: flagged.length, slots: todo.map((x) => x.id) } });
  return { project: upd, generated, failed };
}

/** STEP 9: edits — content and/or settings; every change keeps the previous version (undo). */
export async function updateProject(id: string, patch: { content?: unknown; settings?: unknown; note?: string; removeImage?: string }, user: User) {
  const p = await loadProject(id, user);
  const data: Prisma.EduProjectUpdateInput = { versions: await snapshot(p, patch.note ?? 'تعديل') };
  if (patch.content !== undefined) { const c = ContentSchema.safeParse(patch.content); if (!c.success) throw new AppError('INVALID', 'محتوى غير صالح.', 422); data.content = c.data as unknown as Prisma.InputJsonValue; data.source = 'edited'; data.title = c.data.title || p.title; }
  if (patch.settings !== undefined) {
    const merged = SettingsSchema.safeParse({ ...settingsOf(p), ...(patch.settings as object) });
    if (!merged.success) throw new AppError('INVALID', `إعدادات غير صالحة: ${merged.error.issues.map((i) => i.path.join('.')).join('، ')}`, 422);
    data.settings = merged.data as unknown as Prisma.InputJsonValue;
  }
  if (patch.removeImage) { const imgs = { ...((p.images as Record<string, string> | null) ?? {}) }; delete imgs[patch.removeImage]; data.images = imgs as unknown as Prisma.InputJsonValue; }
  data.steps = mark(stepsOf(p), 'edit', 'done', patch.note ?? 'تعديل') as unknown as Prisma.InputJsonValue;
  return prisma.eduProject.update({ where: { id }, data });
}

export async function undo(id: string, user: User) {
  const p = await loadProject(id, user);
  const v = ((p.versions as { content: unknown; settings: unknown; note: string }[] | null) ?? []);
  const last = v[v.length - 1];
  if (!last) throw new AppError('NO_VERSION', 'لا توجد نسخة سابقة للتراجع إليها.', 409);
  return prisma.eduProject.update({ where: { id }, data: { content: (last.content ?? undefined) as Prisma.InputJsonValue | undefined, settings: last.settings as Prisma.InputJsonValue, versions: v.slice(0, -1) as unknown as Prisma.InputJsonValue } });
}

export async function rewriteSection(id: string, sectionId: string, user: User) {
  const p = await loadProject(id, user);
  const s = settingsOf(p), c = contentOf(p);
  if (!c) throw new AppError('NO_CONTENT', 'أنشئ المحتوى أولًا.', 409);
  const sec = await regenerateSection(s, c, sectionId);
  return updateProject(id, { content: { ...c, sections: c.sections.map((x) => (x.id === sectionId ? sec : x)) }, note: `إعادة كتابة «${sec.heading}»` }, user);
}

/** STEP 7–8: layout + preview (same engine as the export, lower DPI). Returns stored page images + guides. */
export async function preview(id: string, user: User, dpi = 110) {
  const p = await loadProject(id, user);
  const s = settingsOf(p), c = contentOf(p);
  if (!c) throw new AppError('NO_CONTENT', 'أنشئ المحتوى أولًا.', 409);
  const doc = await renderDoc(s, c, { dpi, images: (p.images as Record<string, string> | null) ?? {} });
  const stamp = Date.now().toString(36);
  const pages = [];
  for (const [i, pg] of doc.pages.entries()) {
    const key = `edu/${id}/preview/${i}.png`; // one file per page, replaced on each preview (no pile-up)
    await storage().put(key, pg.png, 'image/png');
    pages.push({ key, v: stamp, label: pg.label, widthPx: pg.widthPx, heightPx: pg.heightPx, trimMm: pg.trimMm, bleedMm: pg.bleedMm, dpi, folds: pg.folds, regions: pg.regions.map((r) => ({ id: r.id, label: r.label, rect: r.rect, safe: r.safe })) });
  }
  const qc = runQc(s, c, doc, { source: (p.source as 'ai' | 'sample' | 'edited') ?? 'ai' });
  let steps = mark(mark(stepsOf(p), 'layout', 'done', `${doc.pages.length} ${PRESETS[s.type].engine === 'panels' ? 'وجه' : 'صفحة'}`), 'preview', 'done');
  steps = mark(steps, 'qc', qc.status === 'FAIL' ? 'failed' : qc.status === 'WARNING' ? 'warning' : 'done', `فحص مبدئي: ${qc.status}`);
  await prisma.eduProject.update({ where: { id }, data: { steps: steps as unknown as Prisma.InputJsonValue, qc: qc as unknown as Prisma.InputJsonValue } });
  return { pages, qc, fontScale: doc.fontScale, style: resolveStyle(s), panelOrder: s.panelOrder ?? (PRESETS[s.type].engine === 'panels' ? defaultPanelOrder(s.lang) : null) };
}

/** STEP 10–12: print files at 300 DPI (PDF + PNG/JPG per page), re-opened and checked before they are offered. */
export async function exportFiles(id: string, formats: ('pdf' | 'png' | 'jpg')[], user: User) {
  const p = await loadProject(id, user);
  const s = settingsOf(p), c = contentOf(p);
  if (!c) throw new AppError('NO_CONTENT', 'أنشئ المحتوى أولًا.', 409);
  const doc = await renderDoc(s, c, { dpi: 300, images: (p.images as Record<string, string> | null) ?? {} });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const base = `edu/${id}/export/${stamp}`;
  const safeName = (p.title || 'education').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'education';
  const files: { kind: string; name: string; key: string; bytes: number; page?: number }[] = [];
  const imgChecks: { name: string; ok: boolean; w: number; h: number }[] = [];
  const jpegs: Buffer[] = [];
  for (const [i, pg] of doc.pages.entries()) {
    const jpg = await sharp(pg.png).flatten({ background: '#ffffff' }).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).withMetadata({ density: 300 }).toBuffer();
    jpegs.push(jpg);
    const suffix = doc.pages.length > 1 ? `-${i + 1}` : '';
    if (formats.includes('png')) { const png = await sharp(pg.png).withMetadata({ density: 300 }).png().toBuffer(); const name = `${safeName}${suffix}.png`; const key = `${base}/${name}`; await storage().put(key, png, 'image/png'); files.push({ kind: 'png', name, key, bytes: png.length, page: i }); const m = await sharp(png).metadata(); imgChecks.push({ name, ok: m.width === pg.widthPx && m.height === pg.heightPx, w: m.width ?? 0, h: m.height ?? 0 }); }
    if (formats.includes('jpg')) { const name = `${safeName}${suffix}.jpg`; const key = `${base}/${name}`; await storage().put(key, jpg, 'image/jpeg'); files.push({ kind: 'jpg', name, key, bytes: jpg.length, page: i }); const m = await sharp(jpg).metadata(); imgChecks.push({ name, ok: m.width === pg.widthPx && m.height === pg.heightPx, w: m.width ?? 0, h: m.height ?? 0 }); }
  }
  const pdf = buildPdf(doc.pages.map((pg, i) => ({ jpeg: jpegs[i], widthPx: pg.widthPx, heightPx: pg.heightPx, trimMm: pg.trimMm, bleedMm: pg.bleedMm })), { title: safeName });
  const pdfCheck = inspectPdf(pdf);
  if (formats.includes('pdf')) { const name = `${safeName}.pdf`; const key = `${base}/${name}`; await storage().put(key, pdf, 'application/pdf'); files.push({ kind: 'pdf', name, key, bytes: pdf.length }); }
  const qc: EduQc = runQc(s, c, doc, { source: (p.source as 'ai' | 'sample' | 'edited') ?? 'ai', exports: { pdf: pdfCheck, images: imgChecks } });
  let steps = mark(stepsOf(p), 'export', 'done', `${files.length} ملف · ${doc.pages.length} صفحة · 300 DPI`);
  steps = mark(steps, 'qc', qc.status === 'FAIL' ? 'failed' : qc.status === 'WARNING' ? 'warning' : 'done', qc.printReady ? 'اجتاز الفحوص — جاهز للطباعة (RGB)' : `النتيجة: ${qc.status}`);
  steps = mark(steps, 'download', 'done');
  await prisma.eduProject.update({ where: { id }, data: { exports: { at: new Date().toISOString(), files } as unknown as Prisma.InputJsonValue, qc: qc as unknown as Prisma.InputJsonValue, steps: steps as unknown as Prisma.InputJsonValue } });
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'edu.export', targetType: 'edu_project', targetId: id, details: { files: files.length, qc: qc.status } });
  return { files, qc };
}

export async function deleteProject(id: string, user: User) {
  const p = await loadProject(id, user);
  const keys = [...Object.entries((p.images as Record<string, string> | null) ?? {}).filter(([k]) => !k.startsWith('q:')).map(([, v]) => v), ...(((p.exports as { files?: { key: string }[] } | null)?.files) ?? []).map((f) => f.key)];
  await prisma.eduProject.delete({ where: { id } });
  for (const k of keys) await storage().remove(k).catch(() => undefined);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'edu.delete', targetType: 'edu_project', targetId: id });
}
