import sharp from 'sharp';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { getSettings } from '../settings';
import { storage } from '../storage';
import { sha256 } from '../crypto';
import { audit } from '../audit';
import { loadApprovedLogo } from '../brand/logo';
import { renderText } from '../render/text';
import type { Lang } from '../render/fonts';
import { autoApproveAndQueue } from '../publishing/jobs';
import { startOfDayInTz } from '../time';
import { log } from '../ops/log';

/**
 * Transparent same-brand cross-promotion: when a feed post / reel / carousel is VERIFIED published on an account,
 * the accounts chosen in its «promoteToIds» get a branded story that clearly says it is our own post elsewhere
 * («جديد على حسابنا @handle»). No fake comments or likes; it goes through the normal approval / autonomy rules,
 * the 30-minute gap and the per-target daily cap.
 */
const W = 1080, H = 1920;
const COPY: Record<Lang, { kicker: string; cta: string }> = {
  ar: { kicker: 'جديد على حسابنا', cta: 'زوروا الحساب وشوفوا التفاصيل' },
  en: { kicker: 'New on our page', cta: 'Visit the page for details' },
  ml: { kicker: 'ഞങ്ങളുടെ പേജിൽ പുതിയത്', cta: 'വിവരങ്ങൾക്ക് പേജ് സന്ദർശിക്കൂ' },
};

export async function renderCrossStory(o: { image: Buffer; logo: Buffer; handle: string; headline: string; lang: Lang }): Promise<{ jpeg: Buffer; fits: boolean }> {
  const bg = await sharp(o.image).resize(W, H, { fit: 'cover' }).blur(40).modulate({ brightness: 0.45 }).png().toBuffer();
  const cardW = 860;
  const card = await sharp(o.image).resize(cardW, 1080, { fit: 'cover' }).png().toBuffer();
  const frame = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cardW + 24}" height="1104"><rect x="2" y="2" width="${cardW + 20}" height="1100" rx="36" fill="none" stroke="#d4af37" stroke-width="6"/></svg>`);
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cardW}" height="1080"><rect width="${cardW}" height="1080" rx="30" fill="#fff"/></svg>`);
  const rounded = await sharp(card).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  const logo = await sharp(o.logo).resize(420, 170, { fit: 'inside' }).png().toBuffer();
  const lm = await sharp(logo).metadata();
  const c = COPY[o.lang];
  const kicker = await renderText({ text: c.kicker, lang: o.lang, weight: 'extrabold', color: '#ecd58c', maxSize: 64, minSize: 36, boxW: 960, boxH: 110, maxLines: 1 });
  const handle = await renderText({ text: `@${o.handle}`, lang: 'en', weight: 'bold', color: '#ffffff', maxSize: 62, minSize: 34, boxW: 960, boxH: 90, maxLines: 1, ltr: true });
  const head = await renderText({ text: o.headline, lang: o.lang, weight: 'bold', color: '#ffffff', maxSize: 50, minSize: 30, boxW: 940, boxH: 130, maxLines: 2 });
  const cta = await renderText({ text: c.cta, lang: o.lang, weight: 'bold', color: '#0b1730', maxSize: 44, minSize: 28, boxW: 760, boxH: 70, maxLines: 1 });
  const pill = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="820" height="110"><rect width="820" height="110" rx="55" fill="#d4af37"/></svg>`);
  const mid = (w: number) => Math.round((W - w) / 2);
  const jpeg = await sharp(bg).composite([
    { input: logo, left: mid(lm.width!), top: 70 },
    { input: kicker.png, left: mid(kicker.width), top: 270 },
    { input: handle.png, left: mid(handle.width), top: 370 },
    { input: frame, left: mid(cardW + 24), top: 478 },
    { input: rounded, left: mid(cardW), top: 490 },
    { input: head.png, left: mid(head.width), top: 1590 + Math.round((130 - head.height) / 2) },
    { input: pill, left: mid(820), top: 1765 },
    { input: cta.png, left: mid(cta.width), top: 1765 + Math.round((110 - cta.height) / 2) },
  ]).flatten({ background: '#0b1730' }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  return { jpeg, fits: [kicker, handle, head, cta].every((t) => t.fits && !t.missing.length) };
}

export async function queueCrossPromo(adId: string) {
  try {
    const s = await getSettings();
    if (!s.publishing.crossPromo.enabled) return [];
    const ad = await prisma.advertisement.findUnique({ where: { id: adId }, include: { account: true, media: true } });
    if (!ad || ad.format === 'IMAGE_STORY' || !ad.account.promoteToIds.length) return [];
    if ((ad.options as { crossPromo?: unknown } | null)?.crossPromo) return []; // never promote a promotion
    const img = ad.media.find((m) => m.role === 'FINAL') ?? ad.media.find((m) => m.role === 'THUMBNAIL');
    if (!img) return [];
    const image = await storage().get(img.storageKey);
    const logo = await loadApprovedLogo(ad.account.businessId);
    const handle = (ad.account.handle || ad.account.name).replace(/^@/, '');
    const targets = await prisma.socialAccount.findMany({ where: { id: { in: ad.account.promoteToIds, not: ad.accountId }, paused: false, connection: { status: 'CONNECTED', canPublish: true } } });
    const since = startOfDayInTz();
    const created: string[] = [];
    for (const t of targets) {
      const today = await prisma.advertisement.count({ where: { accountId: t.id, createdBy: 'cross-promo', createdAt: { gte: since } } });
      if (today >= s.publishing.crossPromo.maxPerTargetPerDay) continue;
      const lang = t.language as Lang;
      const r = await renderCrossStory({ image, logo: logo.buffer, handle, headline: ad.headline ?? '', lang });
      const qc = { passed: r.fits, publishable: r.fits, requiresHuman: false, checkedAt: new Date().toISOString(), checks: [
        { id: 'logo_present', label: 'الشعار الرسمي موجود في التصميم', passed: true, severity: 'BLOCKER' },
        { id: 'text_fits', label: 'النصوص داخل حدودها وبحروف صحيحة', passed: r.fits, severity: 'BLOCKER' },
        { id: 'cross_promo', label: 'ترويج شفاف لمنشور من حساباتنا', passed: true, severity: 'INFO' },
      ] };
      const promo = await prisma.advertisement.create({ data: {
        accountId: t.id, productId: ad.productId, format: 'IMAGE_STORY', language: t.language, state: 'QUALITY_REVIEW', dryRun: ad.dryRun, headline: ad.headline, caption: '',
        logoSha256: logo.sha256, qcReport: qc as unknown as Prisma.InputJsonValue, qcPassed: r.fits, createdBy: 'cross-promo',
        options: { crossPromo: { fromAdId: ad.id, fromAccount: ad.account.name, handle } } as Prisma.InputJsonValue,
      } });
      const key = `ads/${t.id}/${promo.id}/final.jpg`;
      await storage().put(key, r.jpeg, 'image/jpeg');
      await prisma.mediaAsset.create({ data: { advertisementId: promo.id, role: 'FINAL', storageKey: key, mimeType: 'image/jpeg', bytes: r.jpeg.length, sha256: sha256(r.jpeg), width: W, height: H } });
      const autonomous = s.publishingMode === 'AUTONOMOUS' && !!s.autonomousAuthorizedAt && t.autonomousAuthorized && t.autoPublishEnabled;
      if (r.fits && autonomous && !ad.dryRun) {
        await autoApproveAndQueue(promo.id, new Date(Date.now() + s.publishing.crossPromo.delayMinutes * 60_000));
      } else {
        await prisma.approvalRequest.create({ data: { advertisementId: promo.id, reason: r.fits ? (s.publishingMode === 'ASSISTED' ? 'ASSISTED_MODE' : 'MANUAL_MODE') : 'QC_FAILED', note: `ترويج لمنشور ${ad.account.name} في ستوري ${t.name}` } });
      }
      await audit({ actorLabel: 'cross-promo', action: 'ad.cross_promo', targetType: 'advertisement', targetId: promo.id, details: { from: ad.id, fromAccount: ad.account.name, to: t.name } });
      created.push(promo.id);
    }
    return created;
  } catch (e) { log.warn('cross_promo.failed', { adId, error: (e as Error).message }); return []; }
}
