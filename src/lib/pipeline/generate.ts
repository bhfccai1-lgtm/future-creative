import type { Advertisement, MediaFormat, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { getSecret, getSettings, type Settings } from '../settings';
import { pickTrack, MOOD_FOR_STYLE } from '../audio/library';
import { fakeSpeech, openaiSpeak, sanitizeScript, voiceScript, estimateTtsCost } from '../audio/tts';
import { autoPersona, autoVoiceLang, personaOf, voiceLangOf, wordsFor } from '../audio/voices';
import { audit, notify } from '../audit';
import { AppError } from '../errors';
import { getBusiness, contactLines, ctaFor, locationsOf } from '../business';
import { loadApprovedLogo } from '../brand/logo';
import { productAllowed, selectProductForAccount } from '../creative/selector';
import { getAiProvider } from '../ai';
import { AiProviderError, type AiProvider, type CreativeBriefOut } from '../ai/types';
import { fullPosterPrompt, scenePrompt } from '../ai/prompts';
import { qualityFor, assertBudget, estimateAdCost, estimateImageCost, estimateTextCost, recordUsage } from '../ai/cost';
import { findDuplicates, recentIdeas, storeFingerprints } from '../dedup';
import { ideaFingerprint, normalizeText } from '../dedup/text';
import { phash } from '../dedup/phash';
import { buildBackground, composeAdvertisement, toJpeg } from '../render/compose';
import { TEMPLATES } from '../render/templates';
import { renderReel } from '../video/reel';
import { runQualityChecks, type QcReport } from '../qc';
import { sha256 } from '../crypto';
import { nextFormatFor } from '../creative/format-mix';
import { renderCarousel, normaliseSlides } from '../render/carousel';
import { getVideoProvider } from '../ai/video';
import { startOfDayInTz } from '../time';
import { veoPrompt, VEO_NEGATIVE, type VeoResult } from '../ai/veo';
import { marketOf, pickContentType, pickOccasion } from '../creative/planner';
import { emitEvent } from '../integrations/events';
import { signedMediaUrl } from '../storage';
import { storage } from '../storage';
import { autoApproveAndQueue } from '../publishing/jobs';
import type { Lang } from '../render/fonts';
import { paletteFor, signaturePoster, DESIGN_STYLES, DESIGN_TYPES, LAYERED_COMPOSITIONS, LENSES, LIGHTING, POSTER_LAYOUTS, THEME_DECOR, type Art, designTypeOf, directionForPrompt, proSceneCount, styleOf, type Direction } from '../creative/options';

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
    : await selectProductForAccount(account, Math.random, p.direction?.categoryId);
  if (!product) throw new AppError('NO_PRODUCT', p.direction?.categoryId ? 'لا توجد منتجات نشطة في فئة الحملة مسموح بها لهذا الحساب — اسمح بالفئة في إعدادات الحساب أو فعّل منتجاتها.' : 'لا توجد منتجات نشطة مسموح بها لهذا الحساب.', 422);

  const lang = (p.language ?? account.language) as Lang; // content language may override the account default
  // GROWTH_MIX rotates Reels / carousel / feed / stories; a campaign set to «تلقائي» uses the mix even for fixed-format accounts
  const format = p.format ?? (await nextFormatFor(p.direction?.autoFormat ? { ...account, formatStrategy: 'GROWTH_MIX' } : account));
  const provider = await getAiProvider(s);
  // Design options chosen by the user
  // Planner: fill "automatic" occasion / content angle (seasonal calendar + rotation) and record it.
  if (!p.direction?.occasion || !p.direction?.contentType) {
    const recent = await prisma.advertisement.findMany({ where: { accountId: account.id, state: { notIn: ['FAILED', 'REJECTED'] } }, orderBy: { createdAt: 'desc' }, take: 6, select: { options: true } });
    const auto: string[] = [];
    const dir: Direction = { ...(p.direction ?? {}) };
    if (!dir.occasion) { const oc = pickOccasion(new Date(), { language: lang, market: marketOf(account) }); if (oc) { dir.occasion = oc; auto.push('occasion'); } }
    if (!dir.contentType && !dir.idea?.trim()) {
      dir.contentType = pickContentType(recent.map((r) => ((r.options ?? {}) as { direction?: Direction | null }).direction?.contentType));
      auto.push('contentType');
    }
    if (auto.length) p = { ...p, direction: { ...dir, autoPicked: auto } };
  }
  // «تلقائي» design style / design method: resolved here and recorded, so reports can compare what was picked.
  if (p.direction?.designStyle === 'auto' || p.direction?.renderMode === 'auto') {
    const dir: Direction = { ...p.direction };
    const auto = [...(dir.autoPicked ?? [])];
    if (dir.designStyle === 'auto') {
      const recent = await prisma.advertisement.findMany({ where: { accountId: account.id }, orderBy: { createdAt: 'desc' }, take: 20, select: { options: true } });
      dir.designStyle = pickLeastRecent(DESIGN_STYLES.map((x) => x.value), recent.map((r) => ((r.options ?? {}) as { designStyle?: string | null }).designStyle ?? null));
      auto.push('designStyle');
    }
    if (dir.renderMode === 'auto') {
      // auto-publishing accounts need verified system text (ai_full always needs a human); otherwise the full AI poster for vertical formats
      dir.renderMode = account.autonomousAuthorized || !(format === 'IMAGE_STORY' || format === 'REEL_VIDEO') ? 'layered' : 'ai_full';
      auto.push('renderMode');
    }
    p = { ...p, direction: { ...dir, autoPicked: auto } };
  }
  const d = p.direction ?? {};
  const style = styleOf(d.designStyle || 'fc_signature'); // the owner's signature look is the default
  let dtype = designTypeOf(d.designType);
  // colour story by occasion / audience — only when the user didn't pick a specific look (default, auto, or the signature style)
  const styleOpen = !d.designStyle || d.designStyle === 'fc_signature' || (d.autoPicked ?? []).includes('designStyle');
  const palette = styleOpen ? paletteFor(d) : null;
  const signature = !d.designStyle || d.designStyle === 'fc_signature';
  const creativeStyle = (style?.prompt ?? s.ai.creativeStyle) + (palette ? ` Colour story: ${palette.decor}.` : '');
  const reelDuration = d.reelDuration ?? account.reelDurationSec;
  const imgQuality = qualityFor(s, format); // per-format quality (e.g. stories low)
  const aiFull = d.renderMode === 'ai_full' && (format === 'IMAGE_STORY' || format === 'REEL_VIDEO');
  const sceneCount = format === 'REEL_VIDEO' && d.reelStyle === 'pro' && !aiFull ? proSceneCount(reelDuration) : 1;
  // Art direction: rotate composition / lighting / lens / poster layout per account so designs stay varied but professional.
  const art = await pickArt(account.id, { aiFull, composition: d.designType, light: style?.theme === 'white_minimal' ? true : style?.theme === 'black_gold' ? false : undefined });
  if (!dtype) dtype = designTypeOf(art.composition);
  const lightingP = LIGHTING.find((x) => x.value === art.lighting)?.prompt, lensP = LENSES.find((x) => x.value === art.lens)?.prompt;
  p = { ...p, direction: { ...(p.direction ?? {}), art } };
  // Up-front budget check for the WHOLE advertisement (incl. extra pro-reel scenes), so a partial spend never happens near the cap.
  if (!provider.isDryRun) await assertBudget(s, estimateAdCost(s, format) + (sceneCount - 1) * estimateImageCost(s, imgQuality));

  const ad = await prisma.advertisement.create({
    data: {
      accountId: account.id, productId: product.id, format, language: lang, state: 'GENERATING', dryRun: provider.isDryRun, createdBy: p.createdBy, scheduleId: p.scheduleId,
      channels: d.channels ?? [],
      options: { designType: d.designType ?? null, designStyle: d.designStyle ?? null, reelStyle: format === 'REEL_VIDEO' ? (d.reelStyle ?? 'standard') : null, reelDuration: format === 'REEL_VIDEO' ? reelDuration : null, audio: format === 'REEL_VIDEO' ? (d.audio ?? s.ai.audio.defaultReelAudio) : null, audioQuery: d.audio === 'instagram' ? (d.audioQuery ?? null) : null, direction: (p.direction ?? null) as Prisma.InputJsonValue, revisionOf: p.revisionOf ?? null },
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
          direction: directionForPrompt(p.direction), occasionKey: p.direction?.occasion, format,
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
    await assertBudget(s, estimateImageCost(s, imgQuality));
    const scene = await withAiJob(ad.id, 'IMAGE', provider, s.ai.imageModel, async (jobId) => {
      const prompt = aiFull
        ? fullPosterPrompt({ lang, headline: brief!.headline, badge: brief!.badge, support: brief!.supportingCopy, features: s.brandFeatures[lang] ?? [], sceneDescription: brief!.sceneDescription + (dtype ? ` Composition: ${dtype.prompt}.` : ''), style: creativeStyle, customPrompt: d.customPrompt, layout: POSTER_LAYOUTS.find((x) => x.value === art.poster)?.prompt, decor: palette?.decor ?? THEME_DECOR[style?.theme ?? 'navy_gold'], signature: signature ? signaturePoster({ bahrain: marketOf(account) !== 'KSA' }) : undefined, lighting: lightingP, lens: lensP })
        : scenePrompt(brief!.sceneDescription + (dtype ? ` Composition: ${dtype.prompt}.` : ''), creativeStyle, { lighting: lightingP, lens: lensP });
      const img = await retrying(s.ai.maxRetries, () => provider.generateScene(prompt, { model: s.ai.imageModel, quality: imgQuality, size: '1024x1536', seedHint: `${ad.id}` }));
      if (!provider.isDryRun) await recordUsage({ jobId, provider: provider.name, model: img.model, kind: 'image', images: 1, costUsd: estimateImageCost(s, imgQuality) });
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
      scene: scene.png, format, lang, templateKey, headline: brief.headline, supportingCopy: brief.supportingCopy, cta, logo: logo.buffer, contacts: contactLines(business, lang), theme: palette?.theme ?? style?.theme,
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
      await assertBudget(s, estimateImageCost(s, imgQuality));
      extraScenes.push(await withAiJob(ad.id, 'IMAGE', provider, s.ai.imageModel, async (jobId) => {
        const img = await retrying(s.ai.maxRetries, () => provider.generateScene(scenePrompt(`${brief!.sceneDescription} ${SHOTS[(i - 1) % SHOTS.length]}`, creativeStyle), { model: s.ai.imageModel, quality: imgQuality, size: '1024x1536', seedHint: `${ad.id}-${i}` }));
        if (!provider.isDryRun) await recordUsage({ jobId, provider: provider.name, model: img.model, kind: 'image', images: 1, costUsd: estimateImageCost(s, imgQuality) });
        return img;
      }));
    }
    const extraBackgrounds = await Promise.all(extraScenes.map((x) => buildBackground(x.png, format, composed.templateKey, contactLines(business, lang).length, style?.theme, features.length)));
    const jpeg = await toJpeg(composed.png);

    // ── Carousel: teaching slides + save/CTA slide (same theme, product backdrop, contacts on every slide) ──
    let carousel: Awaited<ReturnType<typeof renderCarousel>> | null = null;
    if (format === 'IMAGE_CAROUSEL') carousel = await renderCarousel(composed, scene.png, normaliseSlides(brief.slides, lang), lang);

    // ── Step 11: format (real video for Reels) ──
    let video: Awaited<ReturnType<typeof renderReel>> | null = null;
    let videoError: string | null = null;
    // Gemini Veo: real AI motion from the product scene (first frame), then our verified overlays on top.
    const engine = format === 'REEL_VIDEO' ? (d.videoEngine ?? s.ai.video.engine) : null;
    let veo: VeoResult | null = null;
    let aiVideoNote: string | null = null;
    if (engine === 'veo') {
      try {
        if (aiFull) throw new AppError('VEO_UNSUPPORTED', 'وضع التصميم الكامل بالذكاء الاصطناعي لا يُدمج مع Veo');
        if (provider.isDryRun) throw new AppError('DRY_RUN', 'وضع التجربة (Dry-run) لا يستدعي Veo المدفوع');
        const vp = await getVideoProvider(s);
        if (!vp) throw new AppError('NO_GEMINI_KEY', 'مفتاح Gemini غير مُعدّ (إعدادات الذكاء الاصطناعي ← Gemini Veo)');
        const today = await prisma.aiUsage.count({ where: { kind: 'video', createdAt: { gte: startOfDayInTz() } } });
        if (today >= s.ai.video.maxVeoPerDay) throw new AppError('VEO_DAILY_LIMIT', `بلغ الحد اليومي لفيديوهات Veo (${s.ai.video.maxVeoPerDay})`);
        const cost = s.ai.video.veoDurationSec * s.ai.video.veoPricePerSec;
        await assertBudget(s, cost);
        veo = await withAiJob(ad.id, 'VIDEO', { name: vp.name } as AiProvider, s.ai.video.veoModel, async (jobId) => {
          const r = await vp.generateVideo({ prompt: veoPrompt(brief!.sceneDescription, creativeStyle), image: scene.png, durationSec: s.ai.video.veoDurationSec, resolution: s.ai.video.veoResolution, negativePrompt: VEO_NEGATIVE });
          await recordUsage({ jobId, provider: vp.name, model: r.model, kind: 'video', costUsd: cost });
          return r;
        });
      } catch (e) {
        aiVideoNote = (e as Error).message;
        if (!s.ai.video.fallbackToFfmpeg) throw e;
        await notify('WARNING', 'VEO_FALLBACK', 'تعذر توليد فيديو Gemini Veo', `استُخدم محرك FFmpeg بدلًا منه: ${aiVideoNote}`, account.id);
      }
    }
    let audioNote: Record<string, unknown> | null = null;
    if (format === 'REEL_VIDEO') {
      const audio = d.audio ?? s.ai.audio.defaultReelAudio;
      try {
        // licensed music (rotated, mood follows the design style) and a voice-over of the VERIFIED copy only
        const track = audio === 'library' || audio === 'voiceover' ? await pickTrack(MOOD_FOR_STYLE[d.designStyle ?? ''] ?? undefined) : null;
        let voice: Buffer | undefined;
        if (audio === 'voiceover') {
          // persona & dialect: settings, or «تلقائي» (category → persona rotation; audience/market → Bahraini by default)
          const recentPersonas = (await prisma.advertisement.findMany({ where: { accountId: account.id, format: 'REEL_VIDEO' }, orderBy: { createdAt: 'desc' }, take: 4, select: { options: true } }))
            .map((r) => ((r.options ?? {}) as { audioUsed?: { persona?: string } }).audioUsed?.persona).filter((x): x is string => !!x);
          const category = (await prisma.productCategory.findUnique({ where: { id: product.categoryId }, select: { nameAr: true } }))?.nameAr ?? '';
          const persona = personaOf(s.ai.audio.persona) ?? personaOf(autoPersona(category, recentPersonas))!;
          const vlang = voiceLangOf(s.ai.audio.voiceLang) ?? voiceLangOf(autoVoiceLang({ market: d.market ?? (marketOf(account) === 'KSA' ? 'gcc_saudi' : null), contentLang: lang }))!;
          const seconds = Math.max(3, (veo ? veo.durationSec + 3 : reelDuration) - 3.5);
          const maxWords = wordsFor(seconds, persona);
          let script = voiceScript({ headline: brief.headline, badge: brief.badge, support: brief.supportingCopy, cta });
          try {
            if (provider.writeVoiceover) {
              const w = await provider.writeVoiceover({ language: vlang.prompt, persona: persona.acting, seconds, maxWords, copy: { headline: brief.headline, badge: brief.badge, support: brief.supportingCopy, cta, caption: brief.caption }, product: { titleEn: product.titleEn, titleAr: product.titleAr } }, s.ai.textModel);
              if (!provider.isDryRun) await recordUsage({ provider: provider.name, model: w.model, kind: 'text', inputTokens: w.usage.inputTokens, outputTokens: w.usage.outputTokens, costUsd: estimateTextCost(s, w.usage.inputTokens, w.usage.outputTokens) });
              script = sanitizeScript(w.script, maxWords) ?? script; // rule-breaking script → verified copy instead
            }
            if (provider.isDryRun) voice = fakeSpeech(script);
            else {
              const key = await getSecret('OPENAI_API_KEY');
              if (!key) throw new Error('مفتاح OpenAI غير مضبوط');
              const v = await openaiSpeak(key, script, { persona, lang: vlang });
              voice = v.audio;
              await recordUsage({ provider: 'openai', model: v.model, kind: 'audio', costUsd: estimateTtsCost(v.chars) });
            }
            audioNote = { voiceScript: script, persona: persona.id, voiceLang: vlang.id };
          } catch (e) {
            await notify('WARNING', 'VOICEOVER_FAILED', 'تعذر إنشاء التعليق الصوتي', `أُنتج الريلز بالموسيقى فقط: ${(e as Error).message}`, account.id);
            audioNote = { voiceError: (e as Error).message };
          }
        }
        if (track) audioNote = { ...audioNote, track: track.name, trackId: track.id, license: track.licenseNote };
        video = await renderReel(composed, veo ? veo.durationSec + 3 : reelDuration, {
          extraBackgrounds, audio, baseVideo: veo?.mp4,
          nativeAudio: !!veo && s.ai.video.nativeAudio && (!d.audio || d.audio === 'none'), // an explicit music choice wins; Instagram audio stays silent
          music: track ? { buf: track.buf, ext: track.ext, startSec: track.startSec } : undefined,
          voice, sfx: s.ai.audio.sfx, musicVolume: s.ai.audio.musicVolume,
        });
      } catch (e) { videoError = (e as Error).message; }
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
    if (video && audioNote) {
      const o = (await prisma.advertisement.findUniqueOrThrow({ where: { id: ad.id }, select: { options: true } })).options as Record<string, unknown> | null;
      await prisma.advertisement.update({ where: { id: ad.id }, data: { options: { ...(o ?? {}), audioUsed: { ...audioNote, voiceOver: !!video.voiceOver, sfx: !!video.sfx, musicTrack: !!video.musicTrack } } as Prisma.InputJsonValue } });
    }
    if (veo) await put('SOURCE_VIDEO', 'veo.mp4', veo.mp4, 'video/mp4', { meta: { model: veo.model, operation: veo.operation, durationSec: veo.durationSec } });
    if (engine) {
      const opts = (await prisma.advertisement.findUniqueOrThrow({ where: { id: ad.id }, select: { options: true } })).options as Record<string, unknown> | null;
      await prisma.advertisement.update({ where: { id: ad.id }, data: { options: { ...(opts ?? {}), videoEngine: engine, videoEngineUsed: veo ? 'veo' : 'ffmpeg', veoModel: veo?.model ?? null, nativeAudio: !!video?.nativeAudio, aiVideoNote } as Prisma.InputJsonValue } });
    }
    if (carousel) for (let i = 0; i < carousel.slides.length; i++) await put('SLIDE', `slide-${String(i + 2).padStart(2, '0')}.jpg`, carousel.slides[i], 'image/jpeg', { width: 1080, height: 1350, meta: { index: i + 2 } });
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
      lang, format, headline: brief.headline, badge: brief.badge, supportingCopy: brief.supportingCopy, cta, caption: brief.caption, hashtags: brief.hashtags,
      manifest: composed.manifest, background: composed.background, finalImage: jpeg, logoPng: composed.layers.find((l) => l.id === 'logo')!.png,
      usedLogoSha: logo.sha256, approvedLogoSha: (await loadApprovedLogo(business.id)).sha256,
      approvedPhones: locationsOf(business).map((l) => ({ key: l.key, phone: l.phone })),
      productAllowed: productAllowed(account, product), duplicates: dups, dryRun: provider.isDryRun,
      video: video?.probe ?? null, videoError, aiText, aiTextNeedsHuman: s.ai.aiFullRequiresApproval,
      carousel: carousel ? { images: carousel.slides.length + 1, problems: carousel.problems } : null,
      aiVideo: engine === 'veo' ? { used: !!veo, model: veo?.model ?? null, note: aiVideoNote } : null,
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
    {
      const media = await prisma.mediaAsset.findMany({ where: { advertisementId: ad.id, role: { in: ['FINAL', 'VIDEO', 'SLIDE'] } }, orderBy: { storageKey: 'asc' } });
      const img = media.find((m) => m.role === 'FINAL'); const vid = media.find((m) => m.role === 'VIDEO');
      await emitEvent('ad.ready_for_review', {
        adId: ad.id, account: { id: account.id, name: account.name, handle: account.handle }, format, language: lang,
        headline: updated.headline, caption: updated.caption, product: product.titleAr, reason, dryRun: provider.isDryRun,
        qcPassed: qc.passed, publishable: qc.publishable, requiresHuman: !!qc.requiresHuman,
        imageUrl: img ? signedMediaUrl(img.storageKey) : null, videoUrl: vid ? signedMediaUrl(vid.storageKey) : null,
        slideUrls: media.filter((m) => m.role === 'SLIDE').map((m) => signedMediaUrl(m.storageKey)),
        reviewUrl: `/ads/${ad.id}`,
      });
    }
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
  // Instagram accepts at most 5 hashtags — keep the first 5 unique ones the model ranked highest
  const tags = [...new Set(b.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`).replace(/\s+/g, '_')))].slice(0, 5).join(' ');
  return [b.caption.trim(), tags].filter(Boolean).join('\n\n');
}

/** The option not used for the longest time among `recent` (newest first); unused options come first. */
export function pickLeastRecent(options: string[], recent: (string | null)[]) {
  let best = options[0], bestIdx = -1;
  for (const o of options) {
    const i = recent.indexOf(o);
    if (i === -1) return o;
    if (i > bestIdx) { bestIdx = i; best = o; }
  }
  return best;
}

/** Least-recently-used art recipe for this account (last 12 designs). A user-chosen composition is kept. */
export async function pickArt(accountId: string, o: { aiFull: boolean; composition?: string; light?: boolean }): Promise<Art> {
  const recent = await prisma.advertisement.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' }, take: 12, select: { options: true } });
  const prev = recent.map((r) => ((r.options ?? {}) as { direction?: { art?: Art } | null }).direction?.art ?? {});
  const comps = o.aiFull ? DESIGN_TYPES.map((x) => x.value) : LAYERED_COMPOSITIONS;
  const lights = LIGHTING.filter((x) => o.light === undefined || x.light === o.light).map((x) => x.value);
  let lenses = LENSES.map((x) => x.value) as string[];
  const composition = o.composition ?? pickLeastRecent(comps, prev.map((a) => a.composition ?? null));
  if (composition === 'flat_lay') lenses = ['overhead'];
  else lenses = lenses.filter((l) => l !== 'overhead' && (composition !== 'macro_detail' || l === '85mm' || l === '50mm'));
  return {
    composition,
    lighting: pickLeastRecent(lights, prev.map((a) => a.lighting ?? null)),
    lens: pickLeastRecent(lenses, prev.map((a) => a.lens ?? null)),
    ...(o.aiFull ? { poster: pickLeastRecent(POSTER_LAYOUTS.map((x) => x.value), prev.map((a) => a.poster ?? null)) } : {}),
  };
}
