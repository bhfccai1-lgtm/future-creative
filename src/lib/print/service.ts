import crypto from 'node:crypto';
import path from 'node:path';
import { existsSync } from 'node:fs';
import sharp from 'sharp';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { audit } from '../audit';
import { AppError } from '../errors';
import { storage } from '../storage';
import { getSettings, type Settings } from '../settings';
import { getAiProvider } from '../ai';
import { assertBudget, estimateImageCost, recordUsage } from '../ai/cost';
import { enq } from '../queue/queues';
import { inspectPdf } from '../edu/pdf';
import { fontDir } from '../render/fonts';
import { BriefSchema, analyze, type Analysis, type Brief } from './brief';
import { FAMILIES, available, type Capabilities } from './catalog';
import { buildConcepts, bestConcept, type Concept, type ConceptKey } from './concepts';
import { renderDesign, type PrintPage } from './render';
import { buildMockup } from './mockup';
import { runPrintQa, type QaReport } from './qa';
import { buildPrintPdf } from './pdf';

/**
 * PRINT DESIGN STUDIO workflow:
 * REQUEST → PRODUCT ANALYSIS → CREATIVE CONCEPT → ASSET GENERATION → LAYOUT → PREVIEW → USER REVIEW → PREPRESS → QA → EXPORT
 * (→ AD from the APPROVED version only). Every change keeps a version; approval freezes a hash of the design.
 */
type User = { sub: string; email: string; perms: readonly string[] };
const MAX_VERSIONS = 20;
const NO_TEXT = 'ABSOLUTELY NO text, letters, words, numbers, logos, labels or watermarks anywhere in the image.';

export const capsOf = (s: Settings): Capabilities => ({ ...s.print });
export async function loadPrint(id: string, user: User) {
  const p = await prisma.printProject.findUnique({ where: { id } });
  if (!p || (p.createdBy !== user.email && !user.perms.includes('users:manage'))) throw new AppError('NOT_FOUND', 'المشروع غير موجود.', 404);
  return p;
}
const briefOf = (p: { brief: unknown }) => BriefSchema.parse(p.brief);
const imagesOf = (p: { images: unknown }) => (p.images as Record<string, string> | null) ?? {};
async function snapshot(p: { versions: unknown; brief: unknown; conceptKey: string | null; images: unknown }, note: string) {
  const v = ((p.versions as unknown[] | null) ?? []).slice(-(MAX_VERSIONS - 1));
  return [...v, { at: new Date().toISOString(), brief: p.brief, conceptKey: p.conceptKey, images: p.images ?? null, note }] as unknown as Prisma.InputJsonValue;
}
/** the design identity: brief + chosen concept + pictures — what approval freezes */
const designHash = (brief: unknown, conceptKey: string | null, images: unknown) => crypto.createHash('sha256').update(JSON.stringify({ brief, conceptKey, images: images ?? {} })).digest('hex');

export async function createPrint(input: unknown, user: User) {
  const b = BriefSchema.parse(input);
  const s = await getSettings();
  const a = analyze(b, capsOf(s));
  const concepts = buildConcepts(a, available(a.product, capsOf(s)).finishes);
  const best = bestConcept(concepts);
  const p = await prisma.printProject.create({ data: { title: b.business || b.texts.headline || a.product.ar, productId: a.product.id, brief: b as unknown as Prisma.InputJsonValue, analysis: a as unknown as Prisma.InputJsonValue, concepts: concepts as unknown as Prisma.InputJsonValue, conceptKey: best.key, status: 'designed', createdBy: user.email } });
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'print.create', targetType: 'print_project', targetId: p.id, details: { product: a.product.id, concept: best.key, blockers: a.blockers.length } });
  return p;
}

/** edits a stage (brief fields / concept) — the rest stays as it was; an approved design goes back to review */
export async function updatePrint(id: string, patch: { brief?: Partial<Brief>; conceptKey?: ConceptKey; note?: string }, user: User) {
  const p = await loadPrint(id, user);
  const cur = briefOf(p);
  const b = patch.brief ? BriefSchema.parse({ ...cur, ...patch.brief, texts: { ...cur.texts, ...(patch.brief.texts ?? {}) }, conditions: { ...cur.conditions, ...(patch.brief.conditions ?? {}) } }) : cur;
  const s = await getSettings();
  const a = analyze(b, capsOf(s));
  const concepts = buildConcepts(a, available(a.product, capsOf(s)).finishes);
  const conceptKey = patch.conceptKey ?? (p.conceptKey as ConceptKey | null) ?? bestConcept(concepts).key;
  const changed = designHash(b, conceptKey, p.images) !== p.approvedHash;
  const upd = await prisma.printProject.update({ where: { id }, data: { brief: b as unknown as Prisma.InputJsonValue, productId: a.product.id, analysis: a as unknown as Prisma.InputJsonValue, concepts: concepts as unknown as Prisma.InputJsonValue, conceptKey, versions: await snapshot(p, patch.note ?? 'تعديل'), ...(p.status === 'approved' || p.status === 'exported' ? (changed ? { status: 'designed', approvedHash: null, approvedAt: null } : {}) : {}) } });
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'print.update', targetType: 'print_project', targetId: id, details: { note: patch.note, concept: conceptKey } });
  return upd;
}

export async function undoPrint(id: string, user: User) {
  const p = await loadPrint(id, user);
  const v = ((p.versions as { brief: unknown; conceptKey: string | null; images: unknown }[] | null) ?? []);
  const last = v[v.length - 1]; if (!last) throw new AppError('NO_VERSION', 'لا توجد نسخة سابقة.', 409);
  return prisma.printProject.update({ where: { id }, data: { brief: last.brief as Prisma.InputJsonValue, conceptKey: last.conceptKey, images: (last.images ?? undefined) as Prisma.InputJsonValue | undefined, versions: v.slice(0, -1) as unknown as Prisma.InputJsonValue, status: 'designed', approvedHash: null, approvedAt: null } });
}

async function context(p: Awaited<ReturnType<typeof loadPrint>>) {
  const b = briefOf(p); const s = await getSettings();
  const a: Analysis = analyze(b, capsOf(s));
  const concepts = (p.concepts as Concept[] | null) ?? buildConcepts(a, available(a.product, capsOf(s)).finishes);
  const concept = concepts.find((c) => c.key === p.conceptKey) ?? bestConcept(concepts);
  let logo: Buffer | null = null;
  if (b.logoKey) { try { logo = await storage().get(b.logoKey); } catch { logo = null; } }
  return { b, a, s, concepts, concept, logo, images: imagesOf(p) };
}

/** the AI picture for the design (a scene from the concept's imagery — never text, logos or client data) */
export function heroPrompt(a: Analysis, b: Brief, c: Concept) {
  return [`Professional ${a.product.en.toLowerCase()} artwork for a ${a.identity.en.toLowerCase()} business${b.business ? ` called (do not write it) ${b.business}` : ''}.`,
    b.texts.headline ? `The picture expresses: ${b.texts.headline}.` : '', `Visual direction: ${c.idea}. Metaphor: ${c.metaphor}.`, `Imagery: ${c.imagery}.`,
    `Colour palette: ${c.palette.primary}, ${c.palette.secondary}, ${c.palette.accent}.`, 'Culturally appropriate for Bahrain; modest clothing for any people.', NO_TEXT].filter(Boolean).join(' ');
}
export async function imagePlanPrint(id: string, user: User) {
  const p = await loadPrint(id, user); const { a, b, concept, s } = await context(p);
  const live = !(await getAiProvider(s)).isDryRun;
  const has = !!imagesOf(p).hero;
  return { slot: 'hero', done: has, live, costUsd: Math.round(estimateImageCost(s, 'medium', 1) * 1000) / 1000, prompt: heroPrompt(a, b, concept) };
}
export async function generateHero(id: string, user: User) {
  const p = await loadPrint(id, user); const { a, b, concept, s } = await context(p);
  const provider = await getAiProvider(s);
  if (provider.isDryRun) throw new AppError('NO_AI', 'توليد الصور يحتاج مفتاح OpenAI (وضع التجربة مفعّل).', 412);
  await assertBudget(s, estimateImageCost(s, 'medium', 1));
  const landscape = a.trim.w > a.trim.h * 1.15, portrait = a.trim.h > a.trim.w * 1.15;
  const img = await provider.generateScene(heroPrompt(a, b, concept), { model: s.ai.imageModel, quality: 'medium', size: landscape ? '1536x1024' : portrait ? '1024x1536' : '1024x1024', seedHint: `${id}:hero:${Date.now()}` });
  const meta = await sharp(img.png).metadata(); if (!meta.width) throw new AppError('BAD_IMAGE', 'لم يرجع النموذج صورة صالحة.', 502);
  await recordUsage({ provider: provider.name, model: img.model, kind: 'image', images: 1, costUsd: estimateImageCost(s, 'medium') });
  const key = `print/${id}/hero-${crypto.createHash('sha256').update(img.png).digest('hex').slice(0, 10)}.png`;
  await storage().put(key, img.png, 'image/png');
  const old = imagesOf(p).hero;
  const upd = await prisma.printProject.update({ where: { id }, data: { images: { ...imagesOf(p), hero: key } as unknown as Prisma.InputJsonValue, versions: await snapshot(p, 'صورة جديدة بالذكاء الاصطناعي'), ...(p.status === 'approved' ? { status: 'designed', approvedHash: null, approvedAt: null } : {}) } });
  if (old) await storage().remove(old).catch(() => undefined);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'print.image', targetType: 'print_project', targetId: id, details: { model: img.model } });
  return upd;
}

async function renderAt(p: Awaited<ReturnType<typeof loadPrint>>, dpi: number, preview: boolean) {
  const ctx = await context(p);
  const pages = await renderDesign({ a: ctx.a, b: ctx.b, concept: ctx.concept, dpi, images: ctx.images, logo: ctx.logo, preview });
  return { ...ctx, pages };
}
/** preview dpi: enough to read on a phone without rendering a 2-metre banner at 300 DPI */
const previewDpi = (a: Analysis) => Math.max(12, Math.min(110, Math.round(1600 / (Math.max(a.trim.w, a.trim.h) / 25.4))));

export async function previewPrint(id: string, user: User) {
  const p = await loadPrint(id, user);
  const { a, b, pages, concepts, concept } = await renderAt(p, previewDpi((await context(p)).a), true);
  const stamp = Date.now().toString(36); const out = [];
  for (const [i, pg] of pages.entries()) {
    const key = `print/${id}/preview/${i}.png`;
    await storage().put(key, await sharp(pg.png).flatten({ background: pg.transparentBg ? '#9ca3af' : '#ffffff' }).png().toBuffer(), 'image/png');
    out.push({ key, v: stamp, label: pg.label, widthPx: pg.widthPx, heightPx: pg.heightPx, dpi: pg.dpi, trimMm: pg.trimMm, bleedMm: pg.bleedMm, folds: pg.folds ?? [], cut: pg.cut ?? null, kissCut: pg.kissCut?.length ?? 0, hidden: pg.hidden ?? [], safe: pg.safe, note: pg.note ?? null });
  }
  const qa = runPrintQa(a, b, pages, { approved: p.status === 'approved' || p.status === 'exported', iccProfile: iccName(await getSettings()) });
  await prisma.printProject.update({ where: { id }, data: { qa: qa as unknown as Prisma.InputJsonValue } });
  return { pages: out, qa, analysis: a, concepts, concept: concept.key, status: p.status, images: imagesOf(p) };
}

/** USER REVIEW → APPROVAL: freezes the design hash. Production files and ads only come from an approved design. */
export async function approvePrint(id: string, user: User) {
  const p = await loadPrint(id, user);
  const hash = designHash(p.brief, p.conceptKey, p.images);
  const upd = await prisma.printProject.update({ where: { id }, data: { status: 'approved', approvedHash: hash, approvedAt: new Date() } });
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'print.approve', targetType: 'print_project', targetId: id, details: { hash: hash.slice(0, 12) } });
  return upd;
}
const assertApproved = (p: { status: string; approvedHash: string | null; brief: unknown; conceptKey: string | null; images: unknown }) => {
  if (!['approved', 'exported'].includes(p.status) || p.approvedHash !== designHash(p.brief, p.conceptKey, p.images)) throw new AppError('NOT_APPROVED', 'اعتمد التصميم أولًا — الملفات النهائية والإعلان تُنشأ من النسخة المعتمدة فقط.', 409);
};
const iccName = (s: Settings) => (s.print.iccProfile && existsSync(path.join(fontDir(), s.print.iccProfile)) ? s.print.iccProfile : '');

/** PREPRESS → QA → EXPORT: production PDF (CMYK + spot-colour cut/kiss/fold vectors), previews, cut SVG, white ink, mirrored, source, job ticket */
export async function exportPrint(id: string, user: User) {
  const p = await loadPrint(id, user); assertApproved(p);
  const { a, b, pages, concept, s } = await renderAt(p, Math.min(300, Math.max(a0(p).targetPpi, 72)), false);
  const icc = iccName(s);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const base = `print/${id}/export/${stamp}`;
  const safe = (p.title || a.product.en).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'design';
  const files: { kind: string; name: string; key: string; bytes: number; note?: string }[] = [];
  const put = async (name: string, buf: Buffer, type: string, kind: string, note?: string) => { const key = `${base}/${name}`; await storage().put(key, buf, type); files.push({ kind, name, key, bytes: buf.length, note }); };
  const prod = pages.filter((pg) => pg.note !== 'mirrored');
  const pdfPages = [];
  for (const pg of prod) {
    const flat = sharp(pg.png).flatten({ background: '#ffffff' });
    const jpeg = await (icc ? flat.toColourspace('cmyk').withIccProfile(path.join(fontDir(), icc)) : flat.toColourspace('cmyk')).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
    pdfPages.push({ jpeg, cmyk: true, widthPx: pg.widthPx, heightPx: pg.heightPx, mediaMm: { w: pg.trimMm.w + 2 * pg.bleedMm, h: pg.trimMm.h + 2 * pg.bleedMm }, bleedMm: pg.bleedMm, cut: pg.cut, kissCut: pg.kissCut, folds: pg.folds });
  }
  const pdf = buildPrintPdf(pdfPages, { title: safe, producer: 'PRINT DESIGN MASTER AI V6.0' });
  const check = inspectPdf(pdf);
  if (a.productionPossible) await put(`${safe}-print.pdf`, pdf, 'application/pdf', 'pdf', `CMYK${icc ? ` (${icc})` : ' (ملف عام)'} + طبقات القص/الطي Spot`);
  else await put(`${safe}-PREVIEW-ONLY.pdf`, pdf, 'application/pdf', 'pdf', 'معاينة فقط — بيانات إنتاج أساسية ناقصة');
  for (const [i, pg] of pages.entries()) {
    const sfx = pages.length > 1 ? `-${i + 1}` : '';
    if (pg.note === 'mirrored') { await put(`${safe}${sfx}-mirrored.png`, await sharp(pg.png).withMetadata({ density: pg.dpi }).png().toBuffer(), 'image/png', 'png', pg.label); continue; }
    await put(`${safe}${sfx}.png`, await sharp(pg.png).withMetadata({ density: pg.dpi }).png().toBuffer(), 'image/png', 'png', pg.transparentBg ? 'خلفية شفافة' : 'RGB');
    await put(`${safe}${sfx}-preview.jpg`, await sharp(pg.png).flatten({ background: '#ffffff' }).resize({ width: 1600, height: 1600, fit: 'inside' }).jpeg({ quality: 85 }).toBuffer(), 'image/jpeg', 'jpg', 'معاينة');
    if (pg.cut || pg.kissCut?.length) {
      const mw = pg.trimMm.w + 2 * pg.bleedMm, mh = pg.trimMm.h + 2 * pg.bleedMm;
      const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${mw}mm" height="${mh}mm" viewBox="0 0 ${mw} ${mh}"><g id="CutContour" fill="none" stroke="#ff00ff" stroke-width="0.1">${pg.cut ? `<path d="${pg.cut}"/>` : ''}</g><g id="KissCut" fill="none" stroke="#00ffff" stroke-width="0.1">${(pg.kissCut ?? []).map((d) => `<path d="${d}"/>`).join('')}</g>${pg.folds?.length ? `<g id="Fold" stroke="#00aa00" stroke-width="0.1" stroke-dasharray="3 2">${pg.folds.map((x) => `<line x1="${x}" y1="0" x2="${x}" y2="${mh}"/>`).join('')}</g>` : ''}</svg>`;
      await put(`${safe}${sfx}-cut.svg`, Buffer.from(svg), 'application/octet-stream', 'svg', 'مسار القص Vector (مم)');
    }
    if (pg.white) await put(`${safe}${sfx}-white-ink.png`, pg.white, 'image/png', 'png', 'قناع الحبر الأبيض');
  }
  // editable source: re-opens in the studio and renders identically
  await put(`${safe}.fcprint.json`, Buffer.from(JSON.stringify({ format: 'fc-print/1', brief: b, conceptKey: concept.key, images: imagesOf(p), approvedHash: p.approvedHash }, null, 2)), 'application/octet-stream', 'source', 'المصدر القابل للتعديل');
  const qa: QaReport = runPrintQa(a, b, pages, { exported: { pdf: { ok: check.ok, pages: check.pages.length, problems: check.problems } }, approved: true, iccProfile: icc });
  const ticket = { product: a.product.id, productAr: a.product.ar, family: a.product.family, trimMm: a.trim, bleedMm: a.bleedMm, safeMm: a.safeMm, targetPpi: a.targetPpi, renderDpi: pages[0]?.dpi, sides: a.sides, pages: a.pages, material: a.material, method: a.method, finishes: b.finishes, color: icc ? `CMYK ${icc}` : 'CMYK (generic built-in profile)', pdfx: s.print.pdfx === 'none' ? 'not required' : `${s.print.pdfx} REQUIRED — not produced (NOT_VERIFIED)`, layers: FAMILIES[a.product.family].vectorLayers ?? [], assumptions: a.assumptions, warnings: a.warnings, blockers: a.blockers, approvedHash: p.approvedHash, qa: { overall: qa.overall, productionReady: qa.productionReady, levels: qa.levels } };
  await put(`${safe}-job-ticket.json`, Buffer.from(JSON.stringify(ticket, null, 2)), 'application/octet-stream', 'meta', 'بيانات الإنتاج');
  await prisma.printProject.update({ where: { id }, data: { status: 'exported', exports: { at: new Date().toISOString(), files } as unknown as Prisma.InputJsonValue, qa: qa as unknown as Prisma.InputJsonValue } });
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'print.export', targetType: 'print_project', targetId: id, details: { files: files.length, overall: qa.overall, ready: qa.productionReady } });
  return { files, qa };
}
const a0 = (p: { analysis: unknown }) => p.analysis as Analysis;

/** MOCKUP: from the current (or approved) design pixels — display only */
export async function mockupPrint(id: string, user: User) {
  const p = await loadPrint(id, user);
  const { a, pages } = await renderAt(p, Math.min(150, previewDpi(a0(p)) * 2), false);
  const jpg = await buildMockup(FAMILIES[a.product.family].mockup, pages);
  const key = `print/${id}/mockup-${crypto.createHash('sha256').update(jpg).digest('hex').slice(0, 10)}.jpg`;
  await storage().put(key, jpg, 'image/jpeg');
  if (p.mockupKey) await storage().remove(p.mockupKey).catch(() => undefined);
  await prisma.printProject.update({ where: { id }, data: { mockupKey: key } });
  return { key };
}

/** SOCIAL ADVERTISING: a SEPARATE ad for the printer (own logo + both branch numbers added by the ad pipeline), from the APPROVED design's mockup — waits in the approvals queue */
export async function adFromPrint(id: string, input: { accountIds: string[]; format: 'IMAGE_FEED' | 'IMAGE_STORY' | 'IMAGE_SQUARE'; clientConsent: boolean; note?: string }, user: User) {
  const p = await loadPrint(id, user); assertApproved(p);
  const { key } = await mockupPrint(id, user);
  const a = a0(p); const b = briefOf(p);
  const accounts = await prisma.socialAccount.findMany({ where: { id: { in: input.accountIds } }, select: { id: true, name: true } });
  if (!accounts.length) throw new AppError('NO_ACCOUNT', 'اختر حسابًا واحدًا على الأقل.', 422);
  const idea = [`إعلان لخدمة طباعة «${a.product.ar}» — صورة العرض من تصميم معتمد حقيقي.`, input.note ?? '', input.clientConsent ? `يُسمح بذكر العميل: ${b.business}.` : 'لا تذكر اسم العميل — قل «لأحد عملائنا».', 'لا تذكر أسعارًا أو مدد تسليم أو وعودًا غير مذكورة.'].filter(Boolean).join(' ');
  for (const acc of accounts) await enq.generate({ accountId: acc.id, format: input.format, direction: { realPhotoKey: key, idea, contentType: 'real_work', renderMode: 'layered' }, createdBy: user.email }, `print-${id}-${p.approvedHash?.slice(0, 8)}-${acc.id}`);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'print.ad', targetType: 'print_project', targetId: id, details: { accounts: accounts.map((x) => x.name), hash: p.approvedHash?.slice(0, 12) } });
  return { message: `جاري تجهيز ${accounts.length} إعلان من التصميم المعتمد — تظهر في طابور الموافقات للمراجعة قبل النشر ✓`, approvedHash: p.approvedHash };
}

export async function uploadPrintAsset(id: string, kind: 'logo' | 'dieline', buf: Buffer, user: User) {
  const p = await loadPrint(id, user);
  const meta = await sharp(buf).metadata().catch(() => null);
  if (kind === 'logo' && (!meta || !['png', 'jpeg', 'webp', 'svg'].includes(meta.format ?? ''))) throw new AppError('BAD_LOGO', 'الشعار يجب أن يكون صورة PNG/JPG/SVG.', 422);
  const key = `print/${id}/${kind}-${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)}.${kind === 'logo' ? 'png' : 'bin'}`;
  // the logo is stored as the ORIGINAL pixels (converted to PNG only if needed) — never regenerated
  await storage().put(key, kind === 'logo' && meta?.format !== 'png' ? await sharp(buf).png().toBuffer() : buf, kind === 'logo' ? 'image/png' : 'application/octet-stream');
  return updatePrint(id, { brief: kind === 'logo' ? { logoKey: key } : { dielineKey: key }, note: kind === 'logo' ? 'رفع شعار العميل' : 'رفع Dieline' }, user).then((x) => { void p; return x; });
}

export async function deletePrint(id: string, user: User) {
  const p = await loadPrint(id, user);
  const keys = [...Object.values(imagesOf(p)), ...(((p.exports as { files?: { key: string }[] } | null)?.files) ?? []).map((f) => f.key), ...(p.mockupKey ? [p.mockupKey] : [])];
  await prisma.printProject.delete({ where: { id } });
  for (const k of keys) await storage().remove(k).catch(() => undefined);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'print.delete', targetType: 'print_project', targetId: id });
}
export type { PrintPage };
