import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { parseCsv } from '../competitors/parse';
import { findClaims } from '../qc/checks';

/**
 * Bulk catalogue import (CSV from Excel / Google Sheets). Only the Arabic or English title and the category are
 * required — everything else gets sensible defaults so 500+ products can be loaded in one step. Upserts by slug,
 * so re-importing the same sheet updates instead of duplicating.
 */
export interface ImportRow { line: number; slug: string; category: string; titleAr: string; titleEn: string; titleMl: string | null; audience: string[]; occasions: string[]; visual: string; messagesAr: string[]; messagesEn: string[]; tags: string[]; active: boolean }
export interface ImportError { line: number; message: string }

const H: Record<string, string[]> = {
  slug: ['slug', 'code', 'sku', 'الرمز', 'الكود'],
  category: ['category', 'categorie', 'الفئة', 'القسم', 'التصنيف'],
  titleAr: ['titlear', 'namear', 'arabic', 'الاسمبالعربية', 'الاسمعربي', 'الاسم', 'المنتج', 'الخدمة'],
  titleEn: ['titleen', 'nameen', 'english', 'name', 'title', 'الاسمبالإنجليزية', 'الاسمانجليزي'],
  titleMl: ['titleml', 'malayalam', 'المالايالامية'],
  audience: ['audience', 'targetaudience', 'الجمهور', 'الفئةالمستهدفة'],
  occasions: ['occasions', 'occasion', 'المناسبات', 'المناسبة'],
  visual: ['visual', 'visualguidelines', 'image', 'وصفالصورة', 'الوصف', 'description'],
  messagesAr: ['messagesar', 'messages', 'الرسائل', 'رسائلعربية', 'عبارات'],
  messagesEn: ['messagesen', 'englishmessages', 'رسائلانجليزية'],
  tags: ['tags', 'accounttags', 'الوسوم', 'الحسابات'],
  active: ['active', 'enabled', 'نشط', 'مفعل', 'الحالة'],
};
const norm = (s: string) => s.toLowerCase().replace(/[\s_\-.:()/]+/g, '').replace(/[أإآ]/g, 'ا');
const list = (v: string) => v.split(/[|;،,\n]+/).map((x) => x.trim()).filter(Boolean);

export function slugify(s: string) {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
}
const stableSlug = (titleEn: string, titleAr: string, category: string) => {
  const base = slugify(titleEn);
  if (base.length >= 3) return base;
  return `p-${createHash('sha1').update(`${category}|${titleAr}`).digest('hex').slice(0, 10)}`;
};

export function parseProductCsv(text: string): { rows: ImportRow[]; errors: ImportError[] } {
  const raw = parseCsv(text);
  const errors: ImportError[] = [];
  if (!raw.length) return { rows: [], errors: [{ line: 1, message: 'الملف فارغ أو لا يحتوي صف عناوين' }] };
  const cols = Object.keys(raw[0]);
  const col = (k: string) => cols.find((c) => H[k].some((h) => norm(h) === norm(c)));
  const pick = (r: Record<string, string>, k: string) => { const c = col(k); return c ? (r[c] ?? '').trim() : ''; };
  if (!col('titleAr') && !col('titleEn')) return { rows: [], errors: [{ line: 1, message: 'لا يوجد عمود لاسم المنتج (الاسم / titleAr / titleEn)' }] };
  const rows: ImportRow[] = [];
  const seen = new Set<string>();
  raw.forEach((r, i) => {
    const line = i + 2;
    const titleAr = pick(r, 'titleAr'), titleEn = pick(r, 'titleEn');
    const category = pick(r, 'category') || 'عام';
    if (!titleAr && !titleEn) { errors.push({ line, message: 'الاسم فارغ' }); return; }
    if ((titleAr || titleEn).length > 100) { errors.push({ line, message: 'الاسم أطول من 100 حرف' }); return; }
    const given = slugify(pick(r, 'slug'));
    const slug = given.length >= 3 ? given : stableSlug(titleEn, titleAr, category);
    if (seen.has(slug)) { errors.push({ line, message: `مكرر في الملف (${slug})` }); return; }
    seen.add(slug);
    const messagesAr = list(pick(r, 'messagesAr')).slice(0, 10), messagesEn = list(pick(r, 'messagesEn')).slice(0, 10);
    const claim = findClaims([...messagesAr, ...messagesEn].join(' '));
    if (claim.length) { errors.push({ line, message: `رسائل تحتوي ادعاءات/أسعار ممنوعة: ${claim.join('، ')}` }); return; }
    const act = pick(r, 'active').toLowerCase();
    rows.push({
      line, slug, category,
      titleAr: (titleAr || titleEn).slice(0, 100), titleEn: (titleEn || titleAr).slice(0, 100), titleMl: pick(r, 'titleMl') || null,
      audience: list(pick(r, 'audience')).slice(0, 20), occasions: list(pick(r, 'occasions')).slice(0, 20),
      visual: pick(r, 'visual').slice(0, 1000), messagesAr, messagesEn, tags: list(pick(r, 'tags')).slice(0, 20),
      active: !['0', 'no', 'false', 'لا', 'متوقف', 'غير نشط'].includes(act),
    });
  });
  return { rows, errors };
}

/** Sensible defaults so a title + category is enough. */
export function withDefaults(r: ImportRow) {
  const en = r.titleEn, ar = r.titleAr;
  return {
    name: en.slice(0, 100), titleAr: ar, titleEn: en, titleMl: r.titleMl,
    targetAudience: r.audience.length ? r.audience : ['families', 'businesses', 'gift buyers'],
    occasions: r.occasions.length ? r.occasions : ['everyday', 'gifts'],
    visualGuidelines: r.visual.length >= 10 ? r.visual : `Premium commercial product photo of ${en} as produced by a professional print shop: the printed item is the hero, large and sharp, realistic materials and finish, tasteful props, warm studio lighting.`,
    recommendedMessages: { ar: r.messagesAr.length ? r.messagesAr : [`${ar} بتصميمك الخاص`, `${ar} بجودة طباعة عالية`], en: r.messagesEn.length ? r.messagesEn : [`${en}, designed your way`, `${en} with premium print quality`] },
    relevantAccountTags: r.tags, active: r.active,
  };
}

/** Applies parsed rows. dryRun → counts only (nothing written). Categories are matched by Arabic/English name or slug, else created. */
export async function applyProductImport(rows: ImportRow[], opts: { dryRun: boolean; actor: string }) {
  const cats = await prisma.productCategory.findMany();
  const catKey = (s: string) => norm(s);
  const catMap = new Map<string, string>();
  for (const c of cats) for (const k of [c.slug, c.nameAr, c.nameEn]) catMap.set(catKey(k), c.id);
  const existing = new Set((await prisma.product.findMany({ where: { slug: { in: rows.map((r) => r.slug) } }, select: { slug: true } })).map((p) => p.slug));
  const newCats = [...new Set(rows.map((r) => r.category).filter((c) => !catMap.has(catKey(c))))];
  const summary = { total: rows.length, create: rows.filter((r) => !existing.has(r.slug)).length, update: rows.filter((r) => existing.has(r.slug)).length, newCategories: newCats };
  if (opts.dryRun) return summary;
  for (const name of newCats) {
    const base = slugify(name) || `cat-${createHash('sha1').update(name).digest('hex').slice(0, 8)}`;
    const c = await prisma.productCategory.upsert({ where: { slug: base }, create: { slug: base, nameAr: name, nameEn: /[a-z]/i.test(name) ? name : base }, update: {} });
    catMap.set(catKey(name), c.id);
  }
  // batches keep the transaction small for very large sheets
  for (let i = 0; i < rows.length; i += 100) {
    await prisma.$transaction(rows.slice(i, i + 100).map((r) => {
      const data = { ...withDefaults(r), categoryId: catMap.get(catKey(r.category))!, recommendedMessages: withDefaults(r).recommendedMessages as Prisma.InputJsonValue };
      return prisma.product.upsert({ where: { slug: r.slug }, create: { slug: r.slug, ...data }, update: data });
    }));
  }
  return summary;
}

/** CSV export of the catalogue — also the import template. */
export async function exportProductsCsv() {
  const ps = await prisma.product.findMany({ include: { category: true }, orderBy: [{ category: { nameAr: 'asc' } }, { titleAr: 'asc' }] });
  const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const head = ['slug', 'category', 'titleAr', 'titleEn', 'titleMl', 'audience', 'occasions', 'visual', 'messagesAr', 'messagesEn', 'tags', 'active'];
  const lines = ps.map((p) => {
    const m = p.recommendedMessages as { ar?: string[]; en?: string[] };
    return [p.slug, p.category.nameAr, p.titleAr, p.titleEn, p.titleMl ?? '', p.targetAudience.join(' | '), p.occasions.join(' | '), p.visualGuidelines, (m.ar ?? []).join(' | '), (m.en ?? []).join(' | '), p.relevantAccountTags.join(' | '), p.active ? '1' : '0'].map((v) => q(String(v))).join(',');
  });
  return '﻿' + [head.join(','), ...lines].join('\r\n') + '\r\n';
}

/** Ready-made catalogue files shipped with the app (deploy/catalog/*.csv) — importable from the dashboard without uploading. */
export const PRESET_DIR = 'deploy/catalog';
export async function listPresets(): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  const { join } = await import('node:path');
  try { return (await readdir(join(process.cwd(), PRESET_DIR))).filter((f) => /^[\w-]+\.csv$/.test(f)).sort(); } catch { return []; }
}
export async function readPreset(name: string): Promise<string | null> {
  if (!(await listPresets()).includes(name)) return null; // whitelist: no path traversal
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  return readFile(join(process.cwd(), PRESET_DIR, name), 'utf8');
}

/** Google Sheets share link → CSV export URL (sheet must be shared "anyone with the link"). */
export function sheetsCsvUrl(url: string): string | null {
  const m = url.match(/docs\.google\.com\/spreadsheets\/d\/([\w-]{20,})/);
  if (!m) return null;
  const gid = url.match(/[#&?]gid=(\d+)/)?.[1] ?? '0';
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;
}
