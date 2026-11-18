import sharp from 'sharp';
import crypto from 'node:crypto';
import { storage } from '../storage';
import { AppError } from '../errors';

/**
 * «صور مرجعية»: the real product photo (per product) and one reference design (system-wide).
 * They are sent to the image model together with the prompt, so the poster shows the REAL product and
 * matches the quality/style level the owner wants. Stored normalised (rotated, ≤ 1536 px, PNG, no metadata).
 */
export const MAX_REFERENCE_BYTES = 15 * 1024 * 1024;

export async function normaliseReference(input: Buffer): Promise<Buffer> {
  if (input.length > MAX_REFERENCE_BYTES) throw new AppError('TOO_LARGE', 'الصورة أكبر من 15 ميغابايت.', 413);
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try { meta = await sharp(input).metadata(); } catch { throw new AppError('BAD_IMAGE', 'الملف ليس صورة صالحة (JPG أو PNG أو WEBP).', 422); }
  if (!meta.width || !meta.height || !['jpeg', 'png', 'webp', 'heif', 'avif'].includes(meta.format ?? '')) throw new AppError('BAD_IMAGE', 'الملف ليس صورة صالحة (JPG أو PNG أو WEBP).', 422);
  if (Math.min(meta.width, meta.height) < 256) throw new AppError('TOO_SMALL', 'الصورة صغيرة جدًا — 256 بكسل على الأقل، ويفضّل 1000 بكسل أو أكثر.', 422);
  return sharp(input).rotate().resize(1536, 1536, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).png().toBuffer();
}

export async function saveReference(kind: 'product' | 'style' | 'work', id: string, input: Buffer): Promise<string> {
  const png = await normaliseReference(input);
  const key = `references/${kind}/${id}-${crypto.createHash('sha256').update(png).digest('hex').slice(0, 12)}.png`;
  await storage().put(key, png, 'image/png');
  return key;
}

export async function loadReference(key: string | null | undefined): Promise<Buffer | null> {
  if (!key) return null;
  try { return await storage().get(key); } catch { return null; }
}

/** Prompt lines that tell the image model how to use each attached reference (order = attachment order). */
export function referencePrompt(refs: { role: 'product' }[], styleBrief = ''): string {
  const style = styleBrief.trim() ? `TARGET DESIGN STYLE (from the owner's reference — follow this look and quality level; the content stays exactly as specified above): ${styleBrief.trim()}` : '';
  if (!refs.length) return style;
  const lines = refs.map((_r, i) => `Reference image ${i + 1} is a REAL PHOTO of the product: show exactly this product (same shape, colours, material and proportions) as the hero — do not redesign or replace it; restage it in the new scene with the new lighting. Ignore any text or background in the photo.`);
  return ['ATTACHED REFERENCES:', ...lines, style].filter(Boolean).join('\n');
}

export const STYLE_SLOTS = ['vertical', 'feed', 'square', 'carousel'] as const;
export type StyleSlot = (typeof STYLE_SLOTS)[number];
export const STYLE_SLOT_AR: Record<StyleSlot | 'general', string> = { general: 'عام (لكل الصيغ)', vertical: 'ستوري و Reel (عمودي 9:16)', feed: 'منشور (4:5)', square: 'مربع (1:1)', carousel: 'كاروسيل (شرائح)' };
/** Which reference slots a format looks at, most specific first (the general reference is the last resort). */
export function slotsFor(format: string): StyleSlot[] {
  if (format === 'IMAGE_STORY' || format === 'REEL_VIDEO') return ['vertical'];
  if (format === 'IMAGE_SQUARE') return ['square'];
  if (format === 'IMAGE_CAROUSEL') return ['carousel', 'feed'];
  return ['feed'];
}
