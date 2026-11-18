import crypto from 'node:crypto';
import sharp from 'sharp';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { audit } from '../audit';
import { AppError } from '../errors';
import { storage } from '../storage';
import { getSettings } from '../settings';
import { getAiProvider } from '../ai';
import { assertBudget, estimateImageCost, recordUsage } from '../ai/cost';
import { ContentSchema, PRESETS, SettingsSchema, STEPS, type EduContent, type EduSettings, type StepId, type StepState } from './types';
import { generateContent, regenerateSection } from './content';
import { renderDoc, defaultPanelOrder } from './render';
import { buildPdf, inspectPdf } from './pdf';
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
    const images = await maybeImages(id, s, g.content, (p.images as Record<string, string> | null) ?? {});
    steps = mark(steps, 'images', images.status, images.note);
    const upd = await prisma.eduProject.update({ where: { id }, data: { title: g.content.title || p.title, content: g.content as unknown as Prisma.InputJsonValue, source: g.source, images: images.map as unknown as Prisma.InputJsonValue, steps: steps as unknown as Prisma.InputJsonValue, versions: await snapshot(p, 'قبل إنشاء المحتوى') } });
    await audit({ actorId: user.sub, actorLabel: user.email, action: 'edu.generate', targetType: 'edu_project', targetId: id, details: { source: g.source, fixes: g.fixes.length } });
    return upd;
  } catch (e) {
    steps = mark(steps, 'content', 'failed', (e as Error).message.slice(0, 200));
    await prisma.eduProject.update({ where: { id }, data: { steps: steps as unknown as Prisma.InputJsonValue } });
    throw e;
  }
}

async function maybeImages(id: string, s: EduSettings, content: EduContent, current: Record<string, string>): Promise<{ map: Record<string, string>; status: StepState['status']; note: string }> {
  if (s.images === 'none') return { map: current, status: 'skipped', note: 'بدون صور (حسب الإعداد)' };
  if (current.cover) return { map: current, status: 'done', note: 'الصورة الحالية محفوظة' };
  const settings = await getSettings();
  const provider = await getAiProvider(settings);
  if (provider.isDryRun) return { map: current, status: 'skipped', note: 'توليد الصور يحتاج مفتاح OpenAI — التصميم بدون صورة' };
  const islamic = /إسلام|دين|قرآن|islam/i.test(s.subject);
  const prompt = [`Educational illustration for ${s.grade} pupils about "${content.title}" (${s.subject}).`, `Style: ${s.style === 'auto' ? 'friendly flat educational illustration' : s.style.replace('_', ' ')}, clean, bright, print quality.`,
    islamic ? 'Islamic studies: ONLY geometric Islamic patterns, a mosque, an open book, nature or calligraphy-free ornaments — never people, faces, angels or prophets.' : 'Accurate and age-appropriate; culturally appropriate for Bahrain.',
    'ABSOLUTELY NO text, letters, numbers, words or symbols anywhere in the image. White or very light background.'].join(' ');
  const quality = s.images === 'medium' ? 'medium' : 'low';
  try {
    await assertBudget(settings, estimateImageCost(settings, quality));
    const img = await provider.generateScene(prompt, { model: settings.ai.imageModel, quality, size: '1024x1024', seedHint: id });
    await recordUsage({ provider: provider.name, model: img.model, kind: 'image', images: 1, costUsd: estimateImageCost(settings, quality) });
    const key = `edu/${id}/img-cover-${crypto.createHash('sha256').update(img.png).digest('hex').slice(0, 10)}.png`;
    await storage().put(key, img.png, 'image/png');
    return { map: { ...current, cover: key }, status: 'done', note: 'رسم تعليمي بدون نصوص (النصوص طبقات حقيقية)' };
  } catch (e) { return { map: current, status: 'warning', note: `تعذّر توليد الصورة: ${(e as Error).message.slice(0, 120)} — التصميم يكتمل بدونها` }; }
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
  return { pages, qc, panelOrder: s.panelOrder ?? (PRESETS[s.type].engine === 'panels' ? defaultPanelOrder(s.lang) : null) };
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
  const keys = [...Object.values((p.images as Record<string, string> | null) ?? {}), ...(((p.exports as { files?: { key: string }[] } | null)?.files) ?? []).map((f) => f.key)];
  await prisma.eduProject.delete({ where: { id } });
  for (const k of keys) await storage().remove(k).catch(() => undefined);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'edu.delete', targetType: 'edu_project', targetId: id });
}
