import { captionIssues } from '../creative/caption-quality';
import sharp from 'sharp';
import type { LayerManifest } from '../render/compose';
import type { Lang } from '../render/fonts';
import { checkContrast, checkLanguage, checkLayout, checkLogoPixels, findClaims, findWrongPhones, lintText, type QcCheck } from './checks';
import type { DupFinding } from '../dedup';
import type { VideoProbe } from '../video/probe';
import { FORMAT_SIZE } from '../render/templates';
import { normalizeText } from '../dedup/text';
import type { MediaFormat } from '@prisma/client';

export interface QcInput {
  lang: Lang; format: MediaFormat;
  headline: string; badge?: string | null; supportingCopy?: string | null; cta: string; caption: string;
  manifest: LayerManifest; background: Buffer; finalImage: Buffer; logoPng: Buffer;
  usedLogoSha: string; approvedLogoSha: string;
  approvedPhones: { key: string; phone: string }[];
  productAllowed: boolean; duplicates: DupFinding[]; dryRun: boolean;
  video?: VideoProbe | null; videoError?: string | null;
  /** Full-AI posters: text drawn by the image model + (optional) vision transcription of it. */
  aiText?: { expected: string[]; transcript: string | null } | null;
  /** Admin setting: AI-drawn text needs a human approval (default true). */
  aiTextNeedsHuman?: boolean;
  hashtags?: string[];
  /** Carousel: total images (cover included) and rendering problems. */
  carousel?: { images: number; problems: string[] } | null;
}

export interface QcReport { passed: boolean; publishable: boolean; checks: QcCheck[]; checkedAt: string; requiresHuman?: boolean }

export async function runQualityChecks(q: QcInput): Promise<QcReport> {
  const checks: QcCheck[] = [];
  const logoLayer = q.manifest.layers.find((l) => l.id === 'logo');

  checks.push({ id: 'logo_present', label: 'الشعار الرسمي موجود في التصميم', passed: !!logoLayer, severity: 'BLOCKER' });
  checks.push({ id: 'logo_fingerprint', label: 'بصمة الشعار تطابق الأصل المعتمد', passed: q.usedLogoSha === q.approvedLogoSha, severity: 'BLOCKER', detail: q.usedLogoSha.slice(0, 16) });
  if (logoLayer) checks.push(await checkLogoPixels(q.finalImage, q.background, q.logoPng, logoLayer.rect));

  const phoneLayers = q.manifest.layers.filter((l) => l.id.startsWith('contact:') && l.id.endsWith(':phone'));
  const missingPhones = q.approvedPhones.filter((p) => !phoneLayers.some((l) => l.id === `contact:${p.key}:phone` && l.text === p.phone && l.fits));
  checks.push({ id: 'phones', label: 'أرقام الهواتف الصحيحة (سار وسلماباد) موجودة', passed: q.approvedPhones.length > 0 && missingPhones.length === 0, severity: 'BLOCKER', detail: missingPhones.map((p) => `${p.key}: ${p.phone}`).join(', ') || undefined });

  const allCopy = [q.headline, q.badge ?? '', q.supportingCopy ?? '', q.cta, q.caption];
  const wrong = allCopy.flatMap((t) => findWrongPhones(t, q.approvedPhones.map((p) => p.phone)));
  checks.push({ id: 'no_wrong_numbers', label: 'لا توجد أرقام هواتف غير معتمدة في النص', passed: wrong.length === 0, severity: 'BLOCKER', detail: wrong.join(', ') || undefined });

  checks.push(checkLanguage([q.headline, q.badge ?? '', q.supportingCopy ?? '', q.cta], q.lang));
  const lint = [q.headline, q.badge ?? '', q.supportingCopy ?? '', q.cta].filter(Boolean).flatMap((t) => lintText(t, q.lang).map((i) => `${i}: «${t}»`));
  checks.push({ id: 'proofread', label: 'تدقيق آلي للنص (أخطاء شكلية)', passed: lint.length === 0, severity: 'BLOCKER', detail: lint.join('; ') || undefined });
  const claims = allCopy.flatMap(findClaims);
  checks.push({ id: 'claims', label: 'لا توجد أسعار أو عروض أو ادعاءات غير موثقة', passed: claims.length === 0, severity: 'BLOCKER', detail: claims.join('; ') || undefined });

  checks.push(...checkLayout(q.manifest));
  checks.push(await checkContrast(q.background, q.manifest));

  checks.push({ id: 'product_allowed', label: 'المنتج مسموح لهذا الحساب', passed: q.productAllowed, severity: 'BLOCKER' });

  const meta = await sharp(q.finalImage).metadata();
  const want = FORMAT_SIZE[q.format];
  checks.push({ id: 'image_dimensions', label: `أبعاد الصورة ${want.w}×${want.h}`, passed: meta.width === want.w && meta.height === want.h, severity: 'BLOCKER', detail: `${meta.width}×${meta.height}` });
  checks.push({ id: 'image_format', label: 'صيغة الصورة مدعومة (JPEG)', passed: meta.format === 'jpeg', severity: 'BLOCKER', detail: meta.format });

  if (q.format === 'REEL_VIDEO') {
    const v = q.video;
    const ok = !!v && v.valid;
    checks.push({ id: 'video_valid', label: 'فيديو MP4 صالح (H.264، 1080×1920، المدة المطلوبة)', passed: ok, severity: 'BLOCKER', detail: q.videoError ?? v?.problems.join('; ') ?? 'لم يُنتج فيديو' });
  }

  checks.push({ id: 'duplicates', label: 'ليس تكرارًا محظورًا خلال فترة المنع', passed: q.duplicates.length === 0, severity: 'BLOCKER', detail: q.duplicates.map((d) => `${d.kind}/${d.scope}: ${d.detail}`).join('; ') || undefined });

  if (q.aiText) {
    const t = q.aiText.transcript;
    const norm = (x: string) => normalizeText(x).replace(/\s+/g, '');
    const missing = t ? q.aiText.expected.filter((e) => e.trim() && !norm(t).includes(norm(e))) : q.aiText.expected;
    const garbled = t ? (t.match(/\[\?\]/g)?.length ?? 0) : 0;
    checks.push({
      id: 'ai_text_review', label: 'مراجعة النص المرسوم بالذكاء الاصطناعي (قراءة آلية — تحتاج تأكيدك)', severity: 'WARNING',
      passed: !!t && missing.length === 0 && garbled === 0,
      detail: !t ? 'تعذرت القراءة الآلية — راجع النص بعينك قبل الاعتماد' : [missing.length ? `نص مطلوب لم يُقرأ مطابقًا: ${missing.join(' | ')}` : '', garbled ? `${garbled} كلمة غير واضحة` : ''].filter(Boolean).join('؛ ') || `قُرئ: ${t.replace(/\n/g, ' · ').slice(0, 200)}`,
    });
  }

  if (q.format === 'IMAGE_CAROUSEL') {
    const ok = !!q.carousel && q.carousel.images >= 5 && q.carousel.images <= 10 && q.carousel.problems.length === 0;
    checks.push({ id: 'carousel_slides', label: 'شرائح الكاروسيل مكتملة ومقروءة (5–10 صور، نص يتسع، أرقام الفرعين)', passed: ok, severity: 'BLOCKER', detail: !q.carousel ? 'لم تُنتج الشرائح' : [`${q.carousel.images} صور`, ...q.carousel.problems].join('؛ ') });
  }
  const capIssues = captionIssues(q.caption, { cta: q.cta, hashtags: q.hashtags });
  checks.push({ id: 'caption_quality', label: 'جودة نص المنشور (افتتاحية قصيرة، دعوة واضحة، ≤5 وسوم)', passed: capIssues.length === 0, severity: 'WARNING', detail: capIssues.join('؛ ') || undefined });

  // Dry-run media is a preview only: it may pass design QC but can never be published.
  checks.push({ id: 'real_ai_media', label: 'المحتوى مولد فعليًا (ليس معاينة تجريبية)', passed: !q.dryRun, severity: 'BLOCKER', detail: q.dryRun ? 'وضع التجربة (Dry-run) — غير قابل للنشر' : undefined });

  const blockers = checks.filter((c) => c.severity === 'BLOCKER' && !c.passed);
  const designBlockers = blockers.filter((c) => c.id !== 'real_ai_media');
  return { passed: designBlockers.length === 0, publishable: blockers.length === 0, checks, checkedAt: new Date().toISOString(), requiresHuman: !!q.aiText && q.aiTextNeedsHuman !== false };
}

/**
 * V8 explicit QC verdict.
 *  PASS         — every blocker passed and nothing needs a human
 *  NEEDS_REVIEW — publishable, but a WARNING / AI-drawn text needs a human look
 *  NEEDS_ASSET  — blocked only because a required asset is missing or invalid (logo, media, real AI output)
 *  REJECTED     — content/brand/duplicate violation; regenerate instead of approving
 */
export type QcVerdict = 'PASS' | 'NEEDS_REVIEW' | 'NEEDS_ASSET' | 'REJECTED';
const ASSET_CHECKS = new Set(['logo_present', 'logo_fingerprint', 'image_dimensions', 'image_format', 'video_valid', 'real_ai_media']);
export function qcVerdict(r: QcReport | null | undefined): QcVerdict {
  if (!r) return 'NEEDS_ASSET';
  const failed = r.checks.filter((c) => c.severity === 'BLOCKER' && !c.passed);
  if (failed.length) return failed.every((c) => ASSET_CHECKS.has(c.id)) ? 'NEEDS_ASSET' : 'REJECTED';
  if (r.requiresHuman || r.checks.some((c) => c.severity === 'WARNING' && !c.passed)) return 'NEEDS_REVIEW';
  return 'PASS';
}
export const QC_VERDICT_AR: Record<QcVerdict, string> = { PASS: 'ناجح', NEEDS_REVIEW: 'يحتاج مراجعة', NEEDS_ASSET: 'ينقصه ملف/أصل', REJECTED: 'مرفوض' };
