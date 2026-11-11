import type { Advertisement, MediaFormat, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { getSettings, type Settings } from '../settings';
import { audit, notify } from '../audit';
import { AppError } from '../errors';
import { getBusiness, contactLines, ctaFor, locationsOf } from '../business';
import { loadApprovedLogo } from '../brand/logo';
import { productAllowed, selectProductForAccount } from '../creative/selector';
import { getAiProvider } from '../ai';
import { AiProviderError, type AiProvider, type CreativeBriefOut } from '../ai/types';
import { fullPosterPrompt, scenePrompt } from '../ai/prompts';
import { assertBudget, estimateAdCost, estimateImageCost, estimateTextCost, recordUsage } from '../ai/cost';
import { findDuplicates, recentIdeas, storeFingerprints } from '../dedup';
import { ideaFingerprint, normalizeText } from '../dedup/text';
import { phash } from '../dedup/phash';
import { buildBackground, composeAdvertisement, toJpeg } from '../render/compose';
import { TEMPLATES } from '../render/templates';
import { renderReel } from '../video/reel';
import { runQualityChecks, type QcReport } from '../qc';
import { sha256 } from '../crypto';
import { nextFormatFor } from '../creative/format-mix';
import { storage } from '../storage';
import { startOfDayInTz } from '../time';
import { autoApproveAndQueue } from '../publishing/jobs';
import type { Lang } from '../render/fonts';
import { designTypeOf, directionForPrompt, proSceneCount, styleOf, type Direction } from '../creative/options';

export interface GenerateParams { accountId: string; productId?: string; format?: MediaFormat; language?: Lang; direction?: Direction; createdBy: string; scheduleId?: string; actorId?: string | null; revisionOf?: string }
export interface GenerateOutcome { advertisement: Advertisement; qc: QcReport | null; queued: boolean }

async function withAiJob<T>(adId: string, kind: string, provider: AiProvider, model: string, fn: (jobId: string) => Promise<T>): Promise<T> {
  const job = await prisma.aiGenerationJob.create({ data: { advertisementId: adId, kind, provider: provider.name, model, status: 'RUNNING', startedAt: new Date(), attempts: 1 } });
  try {
    const r = await fn(job.id);
    await prisma.aiGenerationJob.update({ where: { id: job.id }, data: { status: 'SUCCEEDED', finishedAt: new Date() } });
    return r;
  } catch (e) {
    await prisma.aiGenerationJob.update({ where: { id: job.id }, data: { status: e instanceof AppError && e.code === 'BUDGET_EXCEEDED' ? 'BLOCKED_BUDGET' : 'FAILED', error: (e as Error).message.slice(0, 1000), finishedAt: new Date() } });
    throw e;
  }
}

async function retrying<T>(max: number, fn: (attempt: number) => Promise<T>): Promise<T> {
  let last: unknown;
  for (let a = 0; a <= max; a++) {
    try { return await fn(a); }
    catch (e) {
      last = e;
      if (e instanceof AiProviderError && !e.retryable) throw e;
      if (!(e instanceof AiProviderError)) throw e;
      await new Promise((r) => setTimeout(r, Math.min(8000, 500 * 2 ** a)));
    }
  }
  throw last;
}

export async function assertDailyLimits(s: Settings, accountId: string, maxPerAccount: number) {
  const since = startOfDayInTz();
  const [total, perAcc] = await Promise.all([
    prisma.advertisement.count({ where: { createdAt: { gte: since }, dryRun: false } }),
    prisma.advertisement.count({ where: { createdAt: { gte: since }, accountId } }),
  ]);
  if (!s.ai.dryRun && total >= s.ai.maxDailyAds) throw new AppError('DAILY_LIMIT', `تم بلوغ الحد اليومي للإعلانات (${s.ai.maxDailyAds}).`, 429);
  if (perAcc >= maxPerAccount) throw new AppError('ACCOUNT_DAILY_LIMIT', `تم بلوغ الحد اليومي لهذا الحساب (${maxPerAccount}).`, 429);
}

/** Steps 2–12 of the AI creative director. Never publishes by itself — at most it queues an approved, QC-passed ad. */
export async function generateAdvertisement(p: GenerateParams): Promise<GenerateOutcome> {
  const s = await getSettings();
  const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: p.accountId }, include: { connection: true } });
  const business = await getBusiness();
  await assertDailyLimits(s, account.id, account.maxDailyAds);

  // Brand guard: no approved, untampered logo → nothing is generated.
  const logo = await loadApprovedLogo(business.id);

  const product = p.productId
    ? await prisma.product.findFirstOrThrow({ where: { id: p.productId, active: true } })
    : await selectProductForAccount(account);
  if (!product) throw new AppError('NO_PRODUCT', 'لا توجد منتجات نشطة مسموح بها لهذا الحساب.', 422);

  const lang = (p.language ?? account.language) as Lang; // content language may override the account default
  const format = p.format ?? (await nextFormatFor(account)); // GROWTH_MIX rotates Reels / feed / stories
  const provider = await getAiProvider(s);
  // Design options chosen by the user
  const d = p.direction ?? {};
  const style = styleOf(d.designStyle);
  const dtype = designTypeOf(d.designType);
  const creativeStyle = style?.prompt ?? s.ai.creativeStyle;
  const reelDuration = d.reelDuration ?? account.reelDurationSec;
  const aiFull = d.renderMode === 'ai_full' && (format === 'IMAGE_STORY' || format === 'REEL_VIDEO');
  const sceneCount = format === 'REEL_VIDEO' && d.reelStyle === 'pro' && !aiFull ? proSceneCount(reelDuration) : 1;
  // Up-front budget check for the WHOLE advertisement (incl. extra pro-reel scenes), so a partial spend never happens near the cap.
  if (!provider.isDryRun) await assertBudget(s, estimateAdCost(s) + (sceneCount - 1) * estimateImageCost(s, s.ai.imageQuality));

  const ad = await prisma.advertisement.create({
    data: {
      accountId: account.id, productId: product.id, format, language: lang, state: 'GENERATING', dryRun: provider.isDryRun, createdBy: p.createdBy, scheduleId: p.scheduleId,
      channels: d.channels ?? [],
      options: { designType: d.designType ?? null, designStyle: d.designStyle ?? null, reelStyle: format === 'REEL_VIDEO' ? (d.reelStyle ?? 'standard') : null, reelDuration: format === 'REEL_VIDEO' ? reelDuration : null, audio: format === 'REEL_VIDEO' ? (d.audio ?? 'none') : null, audioQuery: d.audio === 'instagram' ? (d.audioQuery ?? null) : null, direction: (p.direction ?? null) as Prisma.InputJsonValue, revisionOf: p.revisionOf ?? null },
    },
  });
  await audit({ actorId: p.actorId, actorLabel: p.createdBy, action: 'ad.generate.start', targetType: 'advertisement', targetId: ad.id, details: { product: product.slug, format, provider: provider.name, language: lang, direction: (p.direction ?? null) as Prisma.InputJsonValue } });

  try {
    // ── Steps 4–8: concept, audience, occasion, brief & copy (with 30-day idea de-duplication) ──
    const history = await recentIdeas(account.id, s.duplicateWindowDays);
    const avoidIdeas = [...history.ideas];
    const avoidHeadlines = [...history.headlines];
    let brief: CreativeBriefOut | null = null;
    let ideaFp = '';
    const maxConceptTries = s.ai.maxRetries + 3;
    for (let attempt = 0; attempt < maxConceptTries && !brief; attempt++) {
      await assertBudget(s, estimateTextCost(s, 2500, 800));
      const r = await withAiJob(ad.id, 'BRIEF', provider, s.ai.textModel, async (jobId) => {
        const out = await retrying(s.ai.maxRetries, () => provider.generateBrief({
          language: lang, product: { ...product, recommendedMessages: product.recommendedMessages as Record<string, string[]> },
          accountName: account.name, businessCategory: account.businessCategory, creativeStyle,
          defaultCta: ctaFor(business, lang), avoidIdeas, avoidHeadlines, attempt,
          direction: directionForPrompt(p.direction), occasionKey: p.direction?.occasion,
        }, s.ai.textModel));
        if (!provider.isDryRun) await recordUsage({ jobId, provider: provider.name, model: out.model, kind: 'text', inputTokens: out.usage.inputTokens, outputTokens: out.usage.outputTokens, costUsd: estimateTextCost(s, out.usage.inputTokens, out.usage.outputTokens) });
        return out;
      });
      const fp = ideaFingerprint(product.slug, r.brief.idea, r.brief.ideaKey);
      const dups = await findDuplicates(account.id, { idea: fp, headline: r.brief.headline }, s.duplicateWindowDays, ad.id);
      if (dups.length === 0) { brief = r.brief; ideaFp = fp; }
      else { avoidIdeas.unshift(r.brief.ideaKey, r.brief.idea); avoidHeadlines.unshift(r.brief.headline); }
    }
    if (!brief) throw new AppError('NO_UNIQUE_IDEA', 'تعذر إيجاد فكرة إعلانية غير مكررة خلال فترة المنع لهذا الحساب.', 409);

    const briefRow = await prisma.creativeBrief.create({
      data: {
        accountId: account.id, productId: product.id, language: lang, ideaKey: brief.ideaKey, idea: brief.idea, audience: brief.audience,
        occasion: brief.occasion, sceneDescription: brief.sceneDescription, headline: brief.headline, supportingCopy: brief.supportingCopy || null,
        cta: brief.cta || ctaFor(business, lang), caption: brief.caption, hashtags: brief.hashtags, styleNotes: brief.styleNotes,
        rawJson: { ...brief, direction: p.direction ?? null } as unknown as Prisma.InputJsonValue, provider: provider.name,
      },
    });

    // ── Step 7: AI scene (no text, no logo) ──
    await assertBudget(s, estimateImageCost(s, s.ai.imageQuality));
    const scene = await withAiJob(ad.id, 'IMAGE', provider, s.ai.imageModel, async (jobId) => {
      const prompt = aiFull
        ? fullPosterPrompt({ lang, headline: brief!.headline, badge: brief!.badge, support: brief!.supportingCopy, features: s.brandFeatures[lang] ?? [], sceneDescription: brief!.sceneDescription + (dtype ? ` Composition: ${dtype.prompt}.` : ''), style: creativeStyle, customPrompt: d.customPrompt })
        : scenePrompt(brief!.sceneDescription + (dtype ? ` Composition: ${dtype.prompt}.` : ''), creativeStyle);
      const img = await retrying(s.ai.maxRetries, () => provider.generateScene(prompt, { model: s.ai.imageModel, quality: s.ai.imageQuality, size: '1024x1536', seedHint: `${ad.id}` }));
      if (!provider.isDryRun) await recordUsage({ jobId, provider: provider.name, model: img.model, kind: 'image', images: 1, costUsd: estimateImageCost(s, s.ai.imageQuality) });
      return img;
    });

    // ── Step 9: deterministic layered composition ──
    const cta = ctaFor(business, lang); // official CTA, never AI-invented
    // Premium gold poster by default for vertical formats; classic templates alternate for feed/square.
    const vertical = format === 'IMAGE_STORY' || format === 'REEL_VIDEO';
    const templateKey = aiFull ? 'ai-poster'
      : d.layout && (vertical || d.layout !== 'gold-poster') ? d.layout
      : vertical ? 'gold-poster'
      : TEMPLATES[(await prisma.advertisement.count({ where: { accountId: account.id } })) % TEMPLATES.length].key;
    const features = s.brandFeatures[lang] ?? [];
    const composed = await composeAdvertisement({
      scene: scene.png, format, lang, templateKey, headline: brief.headline, supportingCopy: brief.supportingCopy, cta, logo: logo.buffer, contacts: contactLines(business, lang), theme: style?.theme,
      badge: brief.badge, features,
    });

    // ── Pro reel: extra AI scenes (each a different shot of the SAME product), same layout + theme ──
    const SHOTS = [
      'Second shot of the same product: close-up detail from a different angle, shallow depth of field.',
      'Third shot of the same product: being used naturally in a lifestyle setting.',
      'Fourth shot of the same product: wide establishing shot in its real environment.',
    ];
    const extraScenes: { png: Buffer; model: string }[] = [];
    for (let i = 1; i < sceneCount; i++) {
      await assertBudget(s, estimateImageCost(s, s.ai.imageQuality));
      extraScenes.push(await withAiJob(ad.id, 'IMAGE', provider, s.ai.imageModel, async (jobId) => {
        const img = await retrying(s.ai.maxRetries, () => provider.generateScene(scenePrompt(`${brief!.sceneDescription} ${SHOTS[(i - 1) % SHOTS.length]}`, creativeStyle), { model: s.ai.imageModel, quality: s.ai.imageQuality, size: '1024x1536', seedHint: `${ad.id}-${i}` }));
        if (!provider.isDryRun) await recordUsage({ jobId, provider: provider.name, model: img.model, kind: 'image', images: 1, costUsd: estimateImageCost(s, s.ai.imageQuality) });
        return img;
      }));
    }
    const extraBackgrounds = await Promise.all(extraScenes.map((x) => buildBackground(x.png, format, composed.templateKey, contactLines(business, lang).length, style?.theme, features.length)));
    const jpeg = await toJpeg(composed.png);

    // ── Step 11: format (real video for Reels) ──
    let video: Awaited<ReturnType<typeof renderReel>> | null = null;
    let videoError: string | null = null;
    if (format === 'REEL_VIDEO') {
      try { video = await renderReel(composed, reelDuration, { extraBackgrounds, audio: d.audio ?? 'none' }); }
      catch (e) { videoError = (e as Error).message; }
    }

    // ── Store media ──
    const base = `ads/${account.id}/${ad.id}`;
    const put = async (role: string, name: string, buf: Buffer, mime: string, extra: Partial<Prisma.MediaAssetCreateInput> = {}) => {
      const key = `${base}/${name}`;
      await storage().put(key, buf, mime);
      return prisma.mediaAsset.create({ data: { advertisementId: ad.id, role, storageKey: key, mimeType: mime, bytes: buf.length, sha256: sha256(buf), ...extra } as Prisma.MediaAssetUncheckedCreateInput });
    };
    await put('SCENE', 'scene.png', scene.png, 'image/png', { width: 1024, height: 1536, meta: { model: scene.model, revisedPrompt: scene.revisedPrompt ?? null } });
    for (let i = 0; i < extraScenes.length; i++) await put('SCENE', `scene-${i + 2}.png`, extraScenes[i].png, 'image/png', { width: 1024, height: 1536, meta: { model: extraScenes[i].model, shot: i + 2 } });
    // Perceptual fingerprint of the AI scene (the part that varies) — the template frame is identical across ads by design.
    const finalHash = await phash(scene.png);
    await put('FINAL', 'final.jpg', jpeg, 'image/jpeg', { width: composed.width, height: composed.height, phash: finalHash });
    if (video) {
      await put('VIDEO', 'reel.mp4', video.mp4, 'video/mp4', { width: video.probe.width, height: video.probe.height, durationSec: video.probe.durationSec, meta: video.probe as unknown as Prisma.InputJsonValue });
      await put('THUMBNAIL', 'thumb.jpg', video.thumbnail, 'image/jpeg');
    }
    const primarySha = video ? sha256(video.mp4) : sha256(jpeg);

    await prisma.advertisement.update({ where: { id: ad.id }, data: { state: 'GENERATED', briefId: briefRow.id, headline: brief.headline, caption: buildCaption(brief), logoSha256: logo.sha256, templateKey: composed.templateKey, layerManifest: composed.manifest as unknown as Prisma.InputJsonValue } });

    // ── Full-AI poster: machine-read the text the image model drew (advisory; a human must still approve) ──
    let aiText: { expected: string[]; transcript: string | null } | null = null;
    if (aiFull) {
      const expected = [brief.headline, brief.badge, brief.supportingCopy ?? ''].filter((x) => x.trim());
      let transcript: string | null = null;
      if (provider.readText && !provider.isDryRun) {
        try {
          await assertBudget(s, estimateTextCost(s, 1500, 200));
          const rt = await provider.readText(jpeg, s.ai.textModel);
          transcript = rt.text || null;
          await recordUsage({ provider: provider.name, model: rt.model, kind: 'text', inputTokens: rt.usage.inputTokens, outputTokens: rt.usage.outputTokens, costUsd: estimateTextCost(s, rt.usage.inputTokens, rt.usage.outputTokens) });
        } catch { transcript = null; }
      }
      aiText = { expected, transcript };
    }

    // ── Step 10: automated quality control ──
    const dups = await findDuplicates(account.id, { sha256: primarySha, phash: finalHash, headline: brief.headline }, s.duplicateWindowDays, ad.id);
    const qc = await runQualityChecks({
      lang, format, headline: brief.headline, badge: brief.badge, supportingCopy: brief.supportingCopy, cta, caption: brief.caption,
      manifest: composed.manifest, background: composed.background, finalImage: jpeg, logoPng: composed.layers.find((l) => l.id === 'logo')!.png,
      usedLogoSha: logo.sha256, approvedLogoSha: (await loadApprovedLogo(business.id)).sha256,
      approvedPhones: locationsOf(business).map((l) => ({ key: l.key, phone: l.phone })),
      productAllowed: productAllowed(account, product.id), duplicates: dups, dryRun: provider.isDryRun,
      video: video?.probe ?? null, videoError, aiText, aiTextNeedsHuman: s.ai.aiFullRequiresApproval,
    });

    await storeFingerprints(account.id, ad.id, [
      { kind: 'FILE_SHA256', value: primarySha }, { kind: 'PHASH', value: finalHash },
      { kind: 'HEADLINE', value: normalizeText(brief.headline) }, { kind: 'IDEA', value: ideaFp },
      { kind: 'PRODUCT_OCCASION', value: `${product.slug}|${normalizeText(brief.occasion)}` },
    ]);

    if (format === 'REEL_VIDEO' && !video?.probe.valid) {
      const updated = await prisma.advertisement.update({ where: { id: ad.id }, data: { state: 'FAILED', qcReport: qc as unknown as Prisma.InputJsonValue, qcPassed: false, errorMessage: `تعذر إنتاج فيديو صالح: ${videoError ?? video?.probe.problems.join('; ')}` } });
      await notify('ERROR', 'VIDEO_INVALID', 'فشل إنتاج فيديو Reel', `الإعلان ${ad.id}: ${updated.errorMessage}`, account.id);
      return { advertisement: updated, qc, queued: false };
    }

    let updated = await prisma.advertisement.update({ where: { id: ad.id }, data: { state: 'QUALITY_REVIEW', qcReport: qc as unknown as Prisma.InputJsonValue, qcPassed: qc.passed } });
    await audit({ actorId: p.actorId, actorLabel: p.createdBy, action: 'ad.generate.done', targetType: 'advertisement', targetId: ad.id, details: { qcPassed: qc.passed, publishable: qc.publishable } });

    // ── Step 12: routing by publishing mode ──
    const autonomous = s.publishingMode === 'AUTONOMOUS' && !!s.autonomousAuthorizedAt && account.autonomousAuthorized && account.autoPublishEnabled && (p.createdBy === 'scheduler' || p.createdBy.startsWith('campaign:'));
    if (qc.publishable && !qc.requiresHuman && autonomous) {
      const job = await autoApproveAndQueue(updated.id);
      updated = await prisma.advertisement.findUniqueOrThrow({ where: { id: ad.id } });
      return { advertisement: updated, qc, queued: !!job };
    }
    const reason = !qc.passed ? 'QC_FAILED' : s.publishingMode === 'ASSISTED' ? 'ASSISTED_MODE' : 'MANUAL_MODE';
    const campaignNote = p.createdBy.startsWith('campaign:') ? 'من حملة مجدولة — يُنشر في موعد الحملة بعد الاعتماد' : null;
    await prisma.approvalRequest.create({ data: { advertisementId: ad.id, reason, note: provider.isDryRun ? 'معاينة تجريبية (Dry-run) — غير قابلة للنشر' : campaignNote } });
    if (!qc.passed) await notify('WARNING', 'QC_FAILED', 'إعلان لم يجتز فحص الجودة', `الإعلان ${ad.id} أُرسل إلى طابور المراجعة: ${qc.checks.filter((c) => !c.passed).map((c) => c.label).join('، ')}`, account.id);
    return { advertisement: updated, qc, queued: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const updated = await prisma.advertisement.update({ where: { id: ad.id }, data: { state: 'FAILED', errorMessage: msg.slice(0, 2000) } });
    const title = e instanceof AiProviderError ? `فشل طلب الذكاء الاصطناعي (${e.code})` : e instanceof AppError ? `تعذر توليد الإعلان (${e.code})` : 'خطأ أثناء توليد الإعلان';
    await notify(e instanceof AiProviderError && (e.code === 'AUTH' || e.code === 'BILLING') ? 'CRITICAL' : 'ERROR', `GEN_${e instanceof AiProviderError ? e.code : e instanceof AppError ? e.code : 'ERROR'}`, title, msg, account.id);
    await audit({ actorId: p.actorId, actorLabel: p.createdBy, action: 'ad.generate.failed', targetType: 'advertisement', targetId: ad.id, details: { error: msg.slice(0, 500) } });
    if (p.scheduleId) await prisma.publicationSchedule.update({ where: { id: p.scheduleId }, data: { status: 'FAILED', reason: msg.slice(0, 500) } });
    return { advertisement: updated, qc: null, queued: false };
  }
}

export function buildCaption(b: CreativeBriefOut) {
  const tags = b.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`).replace(/\s+/g, '_')).join(' ');
  return [b.caption.trim(), tags].filter(Boolean).join('\n\n');
}
