import sharp from 'sharp';
import { prisma } from '../db';
import { sha256 } from '../crypto';
import { storage } from '../storage';
import { AppError } from '../errors';

export class LogoUnavailableError extends AppError {
  constructor(message: string) { super('LOGO_UNAVAILABLE', message, 412); }
}

export interface LogoInspection { ok: boolean; errors: string[]; width: number; height: number; hasAlpha: boolean; transparentRatio: number; sha256: string }

/** Validates an uploaded ORIGINAL logo: real PNG, alpha channel with actual transparency, sane dimensions. */
export async function inspectLogo(buf: Buffer): Promise<LogoInspection> {
  const errors: string[] = [];
  const hash = sha256(buf);
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try { meta = await sharp(buf).metadata(); } catch { return { ok: false, errors: ['الملف ليس صورة صالحة'], width: 0, height: 0, hasAlpha: false, transparentRatio: 0, sha256: hash }; }
  if (meta.format !== 'png') errors.push('يجب أن يكون الشعار بصيغة PNG');
  const width = meta.width ?? 0, height = meta.height ?? 0;
  if (width < 300 && height < 300) errors.push('دقة الشعار منخفضة جدًا (يُفضّل 600 بكسل على الأقل)');
  if (buf.length > 10 * 1024 * 1024) errors.push('حجم الملف يتجاوز 10 ميغابايت');
  const hasAlpha = !!meta.hasAlpha;
  let transparentRatio = 0;
  if (!hasAlpha) errors.push('الشعار يجب أن يكون بخلفية شفافة (قناة Alpha)');
  else {
    const { data, info } = await sharp(buf).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
    let t = 0; for (let i = 0; i < data.length; i++) if (data[i] < 16) t++;
    transparentRatio = t / (info.width * info.height);
    if (transparentRatio < 0.02) errors.push('لا توجد مناطق شفافة فعلية في الشعار');
    if (transparentRatio > 0.995) errors.push('الصورة شفافة بالكامل تقريبًا');
  }
  return { ok: errors.length === 0, errors, width, height, hasAlpha, transparentRatio, sha256: hash };
}

export async function uploadLogo(businessId: string, buf: Buffer, uploadedBy: string) {
  const ins = await inspectLogo(buf);
  if (!ins.ok) throw new AppError('LOGO_INVALID', ins.errors.join('؛ '), 422, ins);
  const key = `brand/${businessId}/logo-${ins.sha256.slice(0, 16)}.png`;
  await storage().put(key, buf, 'image/png');
  return prisma.brandAsset.create({
    data: { businessId, kind: 'LOGO_PRIMARY', storageKey: key, sha256: ins.sha256, width: ins.width, height: ins.height, hasAlpha: ins.hasAlpha, mimeType: 'image/png', uploadedBy },
  });
}

/** Approve and activate a logo — exactly one active approved primary logo per business. */
export async function approveLogo(assetId: string, approvedBy: string) {
  const a = await prisma.brandAsset.findUniqueOrThrow({ where: { id: assetId } });
  return prisma.$transaction([
    prisma.brandAsset.updateMany({ where: { businessId: a.businessId, kind: a.kind, active: true }, data: { active: false } }),
    prisma.brandAsset.update({ where: { id: assetId }, data: { approved: true, approvedAt: new Date(), approvedBy, active: true } }),
  ]);
}

/**
 * Loads the approved logo and re-verifies its bytes against the stored SHA-256 fingerprint.
 * Throws LogoUnavailableError if missing, unapproved or tampered — which blocks generation/publishing.
 */
export async function loadApprovedLogo(businessId: string): Promise<{ buffer: Buffer; sha256: string; assetId: string }> {
  const a = await prisma.brandAsset.findFirst({ where: { businessId, kind: 'LOGO_PRIMARY', active: true, approved: true } });
  if (!a) throw new LogoUnavailableError('لا يوجد شعار رسمي معتمد. ارفع الشعار الأصلي (PNG شفاف) واعتمده من صفحة إعدادات الهوية.');
  let buffer: Buffer;
  try { buffer = await storage().get(a.storageKey); } catch { throw new LogoUnavailableError('ملف الشعار المعتمد غير موجود في وحدة التخزين.'); }
  const h = sha256(buffer);
  if (h !== a.sha256) throw new LogoUnavailableError(`بصمة الشعار لا تطابق النسخة المعتمدة (expected ${a.sha256.slice(0, 12)}…, got ${h.slice(0, 12)}…).`);
  return { buffer, sha256: h, assetId: a.id };
}
