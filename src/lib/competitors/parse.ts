import type { CompetitorPost, CompetitorSummary } from './types';

const n = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') { const x = Number(v.replace(/[,\s%]/g, '')); return Number.isFinite(x) ? x : undefined; }
  return undefined;
};
const pick = (o: Record<string, unknown>, ...keys: string[]) => {
  const lower = Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase().replace(/[\s_-]/g, ''), v]));
  for (const k of keys) { const v = lower[k.toLowerCase().replace(/[\s_-]/g, '')]; if (v !== undefined && v !== null && v !== '') return v; }
  return undefined;
};
const handleOf = (v: unknown) => String(v ?? '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/.*$/, '').toLowerCase();
const date = (v: unknown) => {
  if (!v) return undefined;
  if (typeof v === 'number') return new Date(v > 1e12 ? v : v * 1000);
  const s = String(v);
  const d = /^\d{8}$/.test(s) ? new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T12:00:00+03:00`) : new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

/** Tolerant: field names differ between Metricool API versions and CSV exports (and Arabic/English UIs). */
export function parseCompetitors(rows: Record<string, unknown>[]): CompetitorSummary[] {
  return rows.map((r) => ({
    handle: handleOf(pick(r, 'screenName', 'username', 'handle', 'account', 'profile', 'الحساب', 'اسم المستخدم')),
    name: (pick(r, 'displayName', 'name', 'الاسم') as string | undefined) ?? undefined,
    followers: n(pick(r, 'followers', 'followersCount', 'المتابعون', 'المتابعين')),
    posts: n(pick(r, 'posts', 'postsCount', 'feedPosts', 'المنشورات')),
    reels: n(pick(r, 'reels', 'reelsCount', 'الريلز')),
    likes: n(pick(r, 'likes', 'الإعجابات')),
    comments: n(pick(r, 'comments', 'التعليقات')),
    engagement: n(pick(r, 'engagement', 'engagementRate', 'التفاعل')),
  })).filter((c) => c.handle);
}

export function parseCompetitorPosts(rows: Record<string, unknown>[], forcedType?: 'post' | 'reel'): CompetitorPost[] {
  return rows.map((r) => {
    const url = (pick(r, 'url', 'permalink', 'link', 'الرابط') as string | undefined) ?? undefined;
    const rawType = String(pick(r, 'type', 'mediaType', 'contentType', 'النوع') ?? '').toLowerCase();
    const type: 'post' | 'reel' = forcedType ?? (/reel|video|clip|ريل|فيديو/.test(rawType) || /\/reel\//.test(url ?? '') ? 'reel' : 'post');
    const likes = n(pick(r, 'likes', 'الإعجابات')), comments = n(pick(r, 'comments', 'التعليقات'));
    return {
      handle: handleOf(pick(r, 'screenName', 'username', 'handle', 'account', 'الحساب')),
      id: (pick(r, 'postId', 'reelId', 'id') as string | undefined)?.toString(),
      type, url,
      caption: String(pick(r, 'content', 'caption', 'text', 'description', 'النص', 'المحتوى') ?? ''),
      publishedAt: date(pick(r, 'timestamp', 'publishedAt', 'date', 'created', 'التاريخ')),
      likes, comments,
      interactions: n(pick(r, 'interactions', 'totalInteractions', 'التفاعلات')) ?? (likes !== undefined || comments !== undefined ? (likes ?? 0) + (comments ?? 0) : undefined),
      engagement: n(pick(r, 'engagement', 'التفاعل')),
    };
  }).filter((p) => p.handle);
}

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, CRLF, BOM, ; or , separators). */
export function parseCsv(text: string): Record<string, string>[] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) { if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && src[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}
