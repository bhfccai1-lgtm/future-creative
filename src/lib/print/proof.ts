import crypto from 'node:crypto';
import sharp from 'sharp';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { audit, notify } from '../audit';
import { AppError } from '../errors';
import { storage } from '../storage';
import { rateLimit } from '../security/rate-limit';
import { getBusiness, locationsOf } from '../business';
import { textImg } from './text';
import { BriefSchema } from './brief';
import { FINISHES, MATERIALS, productById } from './catalog';
import type { Analysis } from './brief';
import { loadPrint, mockupPrint, previewPages } from './service';

/**
 * ONLINE CLIENT PROOF: a secret link (no login) where the client sees the exact design — watermarked «PROOF» so the
 * images cannot be used as final files — with the specs, then approves or asks for changes. The proof is tied to the
 * design hash it shows: if the design changes afterwards, the link says so and refuses a decision on the old version.
 */
type User = { sub: string; email: string; perms: readonly string[] };
const DAYS = 14;
export const designHashOf = (brief: unknown, conceptKey: string | null, images: unknown) => crypto.createHash('sha256').update(JSON.stringify({ brief, conceptKey, images: images ?? {} })).digest('hex');

async function watermark(png: Buffer): Promise<Buffer> {
  const img = sharp(png).flatten({ background: '#ffffff' }).resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true });
  const base = await img.jpeg({ quality: 85 }).toBuffer();
  const m = await sharp(base).metadata(); const W = m.width ?? 1, H = m.height ?? 1;
  const t = await textImg('بروفة للمراجعة فقط · PROOF', { pt: Math.max(10, Math.round(W / 34)), kmm: 72 / 25.4, w: Math.round(W * 0.9), weight: 'extrabold', color: '#dc2626', align: 'centre' });
  const tile = await sharp(t.png).rotate(-28, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).ensureAlpha(0.22).png().toBuffer();
  const tm = await sharp(tile).metadata();
  // three diagonal bands across the page
  const comps = [0.2, 0.5, 0.8].map((f) => ({ input: tile, left: Math.max(0, Math.round((W - (tm.width ?? 0)) / 2)), top: Math.max(0, Math.round(H * f - (tm.height ?? 0) / 2)) }))
    .filter((c) => c.top + (tm.height ?? 0) <= H && c.left + (tm.width ?? 0) <= W);
  // a semi-transparent watermark (the text alpha is scaled by ensureAlpha above)
  const faded = await Promise.all(comps.map(async (c) => ({ ...c, input: await sharp(c.input).composite([{ input: Buffer.from([255, 255, 255, 90]), raw: { width: 1, height: 1, channels: 4 }, tile: true, blend: 'dest-in' }]).png().toBuffer() })));
  return sharp(base).composite(faded).jpeg({ quality: 85 }).toBuffer();
}

/** creates (or refreshes) the client's proof link for the CURRENT design */
export async function createProof(id: string, user: User) {
  const p = await loadPrint(id, user);
  const hash = designHashOf(p.brief, p.conceptKey, p.images);
  const pages = await previewPages(p);
  const keys: string[] = [];
  const token = p.proofToken && p.proofHash === hash && p.proofExpiresAt && p.proofExpiresAt > new Date() ? p.proofToken : crypto.randomBytes(18).toString('base64url');
  for (const old of ((p.proofKeys as string[] | null) ?? [])) await storage().remove(old).catch(() => undefined);
  const { key: mk } = await mockupPrint(id, user);
  for (const [i, pg] of pages.filter((x) => x.note !== 'mirrored').entries()) {
    const key = `print/${id}/proof/${hash.slice(0, 10)}-${i}.jpg`;
    await storage().put(key, await watermark(pg.png), 'image/jpeg'); keys.push(key);
  }
  const mkey = `print/${id}/proof/${hash.slice(0, 10)}-mockup.jpg`;
  await storage().put(mkey, await watermark(await storage().get(mk)), 'image/jpeg'); keys.unshift(mkey);
  // a new design version starts with no client decision
  const upd = await prisma.printProject.update({ where: { id }, data: { proofToken: token, proofHash: hash, proofExpiresAt: new Date(Date.now() + DAYS * 86400_000), proofKeys: keys as unknown as Prisma.InputJsonValue, ...(p.proofHash !== hash ? { clientDecision: Prisma.DbNull } : {}) } });
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'print.proof', targetType: 'print_project', targetId: id, details: { hash: hash.slice(0, 12), images: keys.length } });
  return { token: upd.proofToken!, path: `/proof/${upd.proofToken}`, expiresAt: upd.proofExpiresAt, images: keys.length };
}

async function byToken(token: string) {
  if (!/^[\w-]{20,40}$/.test(token)) throw new AppError('NOT_FOUND', 'الرابط غير صالح.', 404);
  const p = await prisma.printProject.findUnique({ where: { proofToken: token } });
  if (!p) throw new AppError('NOT_FOUND', 'الرابط غير صالح أو أُلغي.', 404);
  return p;
}

/** what the client sees — no internal data (no creator, no audit, no prompts, no prices) */
export async function publicProof(token: string) {
  const p = await byToken(token);
  const b = BriefSchema.parse(p.brief); const a = p.analysis as Analysis | null;
  const product = productById(p.productId);
  const stale = designHashOf(p.brief, p.conceptKey, p.images) !== p.proofHash;
  const expired = !p.proofExpiresAt || p.proofExpiresAt < new Date();
  const biz = await getBusiness().catch(() => null);
  return {
    title: p.title, product: product?.ar ?? p.productId,
    trim: a?.trim ?? null, sides: a?.sides ?? null, pages: a?.pages ?? null,
    material: a?.material ? MATERIALS[a.material]?.ar ?? a.material : null,
    finishes: b.finishes.map((f) => FINISHES[f]?.ar ?? f),
    images: ((p.proofKeys as string[] | null) ?? []).length,
    decision: (p.clientDecision as { status: string; name: string; note: string; at: string } | null) ?? null,
    stale, expired, expiresAt: p.proofExpiresAt?.toISOString() ?? null,
    shop: biz ? { name: biz.nameAr, phones: locationsOf(biz).map((l) => ({ name: l.nameAr, phone: l.phone })) } : null,
  };
}
export async function proofImage(token: string, n: number) {
  const p = await byToken(token);
  if (!p.proofExpiresAt || p.proofExpiresAt < new Date()) throw new AppError('EXPIRED', 'انتهت صلاحية الرابط.', 410);
  const key = ((p.proofKeys as string[] | null) ?? [])[n];
  if (!key) throw new AppError('NOT_FOUND', 'غير موجود.', 404);
  return storage().get(key);
}

/** the client's decision — once per proof version; approval also approves the design (that exact version) */
export async function decideProof(token: string, input: { decision: 'approve' | 'changes'; name: string; note?: string }, ip: string | null) {
  const rl = await rateLimit(`proof:${token}:${ip ?? '-'}`, 8, 3600);
  if (!rl.ok) throw new AppError('RATE_LIMIT', 'محاولات كثيرة — حاول لاحقًا.', 429);
  const p = await byToken(token);
  if (!p.proofExpiresAt || p.proofExpiresAt < new Date()) throw new AppError('EXPIRED', 'انتهت صلاحية رابط البروفة — اطلب رابطًا جديدًا من المطبعة.', 410);
  const hash = designHashOf(p.brief, p.conceptKey, p.images);
  if (hash !== p.proofHash) throw new AppError('STALE', 'تغيّر التصميم بعد إرسال هذه البروفة — اطلب الرابط الجديد من المطبعة.', 409);
  const prev = p.clientDecision as { status: string } | null;
  if (prev?.status === 'approved') throw new AppError('DONE', 'تم اعتماد هذه البروفة مسبقًا.', 409);
  const name = input.name.trim().slice(0, 80), note = (input.note ?? '').trim().slice(0, 1000);
  if (name.length < 2) throw new AppError('NAME', 'اكتب اسمك.', 422);
  if (input.decision === 'changes' && note.length < 3) throw new AppError('NOTE', 'اكتب التعديلات المطلوبة.', 422);
  const decision = { status: input.decision === 'approve' ? 'approved' : 'changes', name, note, at: new Date().toISOString(), hash: hash.slice(0, 16) };
  await prisma.printProject.update({ where: { id: p.id }, data: { clientDecision: decision as unknown as Prisma.InputJsonValue, ...(input.decision === 'approve' ? { status: p.status === 'exported' ? 'exported' : 'approved', approvedHash: hash, approvedAt: new Date() } : {}) } });
  await audit({ actorLabel: `client:${name}`, action: input.decision === 'approve' ? 'print.proof.approved' : 'print.proof.changes', targetType: 'print_project', targetId: p.id, details: { note: note.slice(0, 300), hash: hash.slice(0, 12) }, ip });
  if (input.decision === 'approve') await notify('INFO', 'PROOF_APPROVED', `✅ اعتمد العميل البروفة: ${p.title}`, `${name} اعتمد التصميم عبر رابط البروفة — جاهز لتجهيز ملفات الإنتاج.`);
  else await notify('WARNING', 'PROOF_CHANGES', `✏️ العميل طلب تعديلات: ${p.title}`, `${name}: ${note.slice(0, 300)}`);
  return decision;
}
