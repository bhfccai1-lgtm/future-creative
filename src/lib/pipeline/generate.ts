import sharp from 'sharp';
import { fitToAlgorithm, type AlgoFit } from '../growth/algorithm';
import { assessImage, retryHint, type ImageQuality } from '../creative/image-quality';
import { applyProofIssues, PROOF_SYSTEM, type ProofCopy, type ProofIssue } from '../creative/ai-proofread';
import { pickFromWeek, programContentTypes } from '../growth/program';
import { findBanned, stripBanned } from '../creative/banned';
import type { Advertisement, MediaFormat, Prisma } from '@prisma/client';
import { autoChannelsFor } from '../publishing/channels';
import { tasteProfile, withoutBlocked } from '../creative/taste';
import { aiTextCheck } from '../qc';
import { prisma } from '../db';
import { getSecret, getSettings, updateSettings, type Settings } from '../settings';
import { pickTrack, MOOD_FOR_STYLE } from '../audio/library';
import { fakeSpeech, openaiSpeak, openaiTranscribe, estimateSttCost, sanitizeScript, voiceScript, estimateTtsCost } from '../audio/tts';
import { applyLexicon, missedWords, speakVerified } from '../audio/pronounce';

/** speech-to-text language code for a voice-over dialect id (ar_bh → ar, ml → ml) */
const sttLang = (id: string) => (id.startsWith('ar') ? 'ar' : /^[a-z]{2}/.exec(id)?.[0]);
import { autoPersona, autoVoiceLang, personaOf, voiceLangOf, wordsFor } from '../audio/voices';
import { audit, notify } from '../audit';
import { AppError } from '../errors';
import { getBusiness, contactLines, ctaFor, locationsOf } from '../business';
import { loadApprovedLogo } from '../brand/logo';
import { productAllowed, selectProductForAccount } from '../creative/selector';
import { getAiProvider, getIdeasProvider } from '../ai';
import { AiProviderError, type AiProvider, type CreativeBriefOut } from '../ai/types';
import { fullPosterPrompt, scenePrompt } from '../ai/prompts';
import { qualityFor, assertBudget, estimateAdCost, estimateImageCost, estimateTextCost, recordUsage } from '../ai/cost';
import { findDuplicates, recentIdeas, storeFingerprints } from '../dedup';
import { ideaFingerprint, normalizeText } from '../dedup/text';
import { phash } from '../dedup/phash';
import { buildBackground, composeAdvertisement, toJpeg } from '../render/compose';
import { TEMPLATES, FORMAT_SIZE } from '../render/templates';
import { aiPosterImageSize, aiPosterGeometry } from '../render/poster';
import { loadReference, referencePrompt, slotsFor } from '../creative/references';
import { captionIssues } from '../creative/caption-quality';
import { scoreConcepts, type ConceptScore } from '../creative/concept-select';
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
import { CONCEPTS, paletteFor, signaturePoster, DESIGN_STYLES, DESIGN_TYPES, LAYERED_COMPOSITIONS, LENSES, LIGHTING, POSTER_LAYOUTS, THEME_DECOR, type Art, designTypeOf, directionForPrompt, proSceneCount, styleOf, type Direction } from '../creative/options';

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
    // the account quota is about how much gets POSTED: a failed design (nothing to post) or a dry-run preview does not
    // use it. The overall cap above still counts failures — it protects the AI budget.
    prisma.advertisement.count({ where: { createdAt: { gte: since }, accountId, dryRun: false, state: { not: 'FAILED' } } }),
  ]);
  const reset = 'يتجدد العدّاد منتصف الليل بتوقيت البحرين';
  if (!s.ai.dryRun && total >= s.ai.maxDailyAds) throw new AppError('DAILY_LIMIT', `تم بلوغ الحد اليومي لكل الإعلانات (${s.ai.maxDailyAds}) — ${reset}. لرفعه: إعدادات الذكاء الاصطناعي ← «الحد الأقصى اليومي للإعلانات».`, 429);
  if (perAcc >= maxPerAccount) throw new AppError('ACCOUNT_DAILY_LIMIT', `تم بلوغ الحد اليومي لهذا الحساب (${perAcc} من ${maxPerAccount} تصاميم اليوم) — ${reset}. لرفعه: الحسابات الاجتماعية ← تعديل الحساب ← «الحد الأقصى اليومي».`, 429);
}

/** Steps 2–12 of the AI creative director. Never publishes by itself — at most it queues an approved, QC-passed ad. */
export async function generateAdvertisement(p: GenerateParams): Promise<GenerateOutcome> {
  const s = await getSettings();
  const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: p.accountId }, include: { connection: true } });
  const business = await getBusiness();
  await assertDailyLimits(s, account.id, account.maxDailyAds);

  // Brand guard: no approved, untampered logo → nothing is generated.
  const logo = await loadApprovedLogo(business.id);

  // campaign multi-choice: pick ONE of the chosen products / categories / formats / content types at random
  p = await pickFromChoices(p);
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
    if (!dir.occasion) { const oc = pickOccasion(new Date(), { language: lang, market: marketOf(account), disabled: s.disabledOccasions }); if (oc) { dir.occasion = oc; auto.push('occasion'); } }
    if (!dir.contentType && !dir.idea?.trim()) {
      const recentTypes = recent.map((r) => ((r.options ?? {}) as { direction?: Direction | null }).direction?.contentType);
      const week = await programContentTypes(account.id); // «برنامج النمو»: this week's content angles
      dir.contentType = week.length ? pickFromWeek(week, recentTypes) : pickContentType(recentTypes);
      auto.push(week.length ? 'contentType:growthProgram' : 'contentType');
    }
    if (auto.length) p = { ...p, direction: { ...dir, autoPicked: auto } };
  }
  // Saudi accounts: market context defaults to Saudi/GCC (no Bahrain references or #البحرين)
  if (marketOf(account) === 'KSA' && !p.direction?.market) p = { ...p, direction: { ...(p.direction ?? {}), market: 'gcc_saudi' } };
  // «يتعلم من ذوقك»: the owner's approvals/rejections (human decisions only)
  const taste = await tasteProfile();
  // 🧠 the account's performance memory (learnt nightly from its real numbers) — 1 design in 5 explores without it
  const brain = await (await import('../growth/brain')).brainGuidance(account.id).catch(() => ({ text: null, mode: 'none' as const, rules: [] as string[], art: {} }));
  const feedback = brain.text ? [...taste.feedback, brain.text] : taste.feedback;
  // automatic designs that didn't choose a method/style use the settings (default: signature style, «تلقائي» method)
  if (!p.direction?.renderMode || !p.direction?.designStyle) {
    p = { ...p, direction: { ...(p.direction ?? {}), renderMode: p.direction?.renderMode ?? s.ai.autoRenderMode, designStyle: p.direction?.designStyle ?? s.ai.autoDesignStyle } };
  }
  // «تلقائي» design style / design method: resolved here and recorded, so reports can compare what was picked.
  if (p.direction?.designStyle === 'auto' || p.direction?.renderMode === 'auto') {
    const dir: Direction = { ...p.direction };
    const auto = [...(dir.autoPicked ?? [])];
    if (dir.designStyle === 'auto') {
      const recent = await prisma.advertisement.findMany({ where: { accountId: account.id }, orderBy: { createdAt: 'desc' }, take: 20, select: { options: true } });
      dir.designStyle = pickLeastRecent(withoutBlocked(DESIGN_STYLES.map((x) => x.value), taste.blocked.designStyle), recent.map((r) => ((r.options ?? {}) as { designStyle?: string | null }).designStyle ?? null));
      auto.push('designStyle');
    }
    if (dir.renderMode === 'auto') {
      // the full AI poster for every format (spell-checked and re-drawn automatically). Exceptions: Veo reels animate a
      // clean product scene, and auto-publishing accounts while the owner still wants to approve full-AI designs by hand
      const veoReel = format === 'REEL_VIDEO' && (dir.videoEngine ?? s.ai.video.engine) === 'veo';
      dir.renderMode = veoReel || (account.autonomousAuthorized && s.ai.aiFullRequiresApproval) ? 'layered' : 'ai_full';
      auto.push('renderMode');
    }
    p = { ...p, direction: { ...dir, autoPicked: auto } };
  }
  // banned phrases never reach the models through the owner's own idea or prompt
  if (p.direction?.idea || p.direction?.customPrompt) p = { ...p, direction: { ...p.direction, ...(p.direction.idea ? { idea: stripBanned(p.direction.idea, s.ai.bannedPhrases) } : {}), ...(p.direction.customPrompt ? { customPrompt: stripBanned(p.direction.customPrompt, s.ai.bannedPhrases) } : {}) } };
  // «أعمال منجزة»: the owner's real photo is the scene — verified text layers only, motion from the still for Reels
  if (p.direction?.realPhotoKey) p = { ...p, direction: { ...p.direction, renderMode: 'layered', videoEngine: 'ffmpeg', reelStyle: 'standard', contentType: 'real_work' } };
  const d = p.direction ?? {};
  const style = styleOf(d.designStyle || 'fc_signature'); // the owner's signature look is the default
  let dtype = designTypeOf(d.designType);
  // colour story by occasion / audience — only when the user didn't pick a specific look (default, auto, or the signature style)
  const styleOpen = !d.designStyle || d.designStyle === 'fc_signature' || (d.autoPicked ?? []).includes('designStyle');
  const categoryName = (await prisma.productCategory.findUnique({ where: { id: product.categoryId }, select: { nameAr: true } }))?.nameAr;
  const palette = styleOpen ? paletteFor(d, categoryName) : null;
  const signature = !d.designStyle || d.designStyle === 'fc_signature';
  const creativeStyle = (style?.prompt ?? s.ai.creativeStyle) + (palette ? ` Colour story: ${palette.decor}.` : '');
  const reelDuration = d.reelDuration ?? account.reelDurationSec;
  const imgQuality = qualityFor(s, format); // per-format quality (e.g. stories low)
  let aiFull = d.renderMode === 'ai_full';
  const posterSize = aiPosterImageSize(FORMAT_SIZE[format].h);
  const sceneCount = format === 'REEL_VIDEO' && d.reelStyle === 'pro' && !aiFull ? proSceneCount(reelDuration) : 1;
  // Art direction: rotate composition / lighting / lens / poster layout per account so designs stay varied but professional.
  const formal = /business|corporate|b2b|شركات/i.test(`${account.name} ${account.handle ?? ''} ${account.businessCategory ?? ''}`);
  const art = await pickArt(account.id, { aiFull, composition: d.designType, light: style?.theme === 'white_minimal' ? true : style?.theme === 'black_gold' ? false : undefined, concept: d.concept, concepts: s.ai.creativeConcepts, formal, blockedConcepts: taste.blocked.concept, prefer: brain.art });
  if (!dtype) dtype = designTypeOf(art.composition);
  const lightingP = LIGHTING.find((x) => x.value === art.lighting)?.prompt, lensP = LENSES.find((x) => x.value === art.lens)?.prompt;
  const conceptP = CONCEPTS.find((x) => x.value === art.concept)?.prompt;
  p = { ...p, direction: { ...(p.direction ?? {}), art } };
  // Up-front budget check for the WHOLE advertisement (incl. extra pro-reel scenes), so a partial spend never happens near the cap.
  if (!provider.isDryRun) await assertBudget(s, estimateAdCost(s, format) + (sceneCount - 1 + Math.max(0, s.ai.bestOf - 1)) * estimateImageCost(s, imgQuality));

  const ad = await prisma.advertisement.create({
    data: {
      accountId: account.id, productId: product.id, format, language: lang, state: 'GENERATING', dryRun: provider.isDryRun, createdBy: p.createdBy, scheduleId: p.scheduleId,
      channels: await withAutoGbp(account, format, withAutoChannels(account, format, (d.channels ?? []) as import('@prisma/client').SocialPlatform[])),
      options: { brain: { mode: brain.mode, rules: brain.rules, ...(Object.keys(brain.art).length ? { art: brain.art } : {}) }, designType: d.designType ?? null, designStyle: d.designStyle ?? null, reelStyle: format === 'REEL_VIDEO' ? (d.reelStyle ?? 'standard') : null, reelDuration: format === 'REEL_VIDEO' ? reelDuration : null, audio: format === 'REEL_VIDEO' ? (d.audio ?? s.ai.audio.defaultReelAudio) : null, audioQuery: d.audio === 'instagram' ? (d.audioQuery ?? null) : null, direction: (p.direction ?? null) as Prisma.InputJsonValue, revisionOf: p.revisionOf ?? null },
    },
  });
  await audit({ actorId: p.actorId, actorLabel: p.createdBy, action: 'ad.generate.start', targetType: 'advertisement', targetId: ad.id, details: { product: product.slug, format, provider: provider.name, language: lang, direction: (p.direction ?? null) as Prisma.InputJsonValue } });

  try {
    // ── Steps 4–8: concept, audience, occasion, brief & copy (with 30-day idea de-duplication) ──
    const history = await recentIdeas(account.id, s.duplicateWindowDays);
    const avoidIdeas = [...history.ideas, ...taste.avoid.ideas];
    const avoidHeadlines = [...history.headlines, ...taste.avoid.headlines];
    // ── STEP 02: three concepts, the strongest wins (documented rubric in creative/concept-select.ts) ──
    let conceptSelection: { chosen: string; candidates: ConceptScore[] } | null = null;
    if (s.ai.conceptTournament && !d.idea?.trim()) {
      try {
        if (!provider.isDryRun) await assertBudget(s, estimateTextCost(s, 2000, 600));
        const r = await (await getIdeasProvider(s)).suggestIdeas({
          language: lang, product: { ...product, recommendedMessages: product.recommendedMessages as Record<string, string[]> },
          accountName: account.name, businessCategory: account.businessCategory, creativeStyle, defaultCta: ctaFor(business, lang),
          avoidIdeas, avoidHeadlines, ownerFeedback: feedback, attempt: 0, direction: directionForPrompt(p.direction), occasionKey: p.direction?.occasion, format,
        }, s.ai.textModel, 3);
        if (!provider.isDryRun) await recordUsage({ provider: provider.name, model: r.model, kind: 'text', inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, costUsd: estimateTextCost(s, r.usage.inputTokens, r.usage.outputTokens) });
        const recentAngles = (await prisma.idea.findMany({ where: { accountId: account.id, status: 'USED' }, orderBy: { createdAt: 'desc' }, take: 10, select: { angle: true } })).map((x) => x.angle).filter((x): x is string => !!x);
        const ranked = scoreConcepts(r.ideas, { format, formal, history: [...history.ideas, ...history.headlines], recentAngles });
        const best = ranked[0];
        if (best && best.total > 0) {
          conceptSelection = { chosen: best.title, candidates: ranked };
          p = { ...p, direction: { ...(p.direction ?? {}), idea: [best.title, best.idea].join(' — ').slice(0, 500) } };
        }
      } catch { /* proposal failed → the brief writer invents the concept itself, as before */ }
    }
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
          direction: directionForPrompt(p.direction), occasionKey: p.direction?.occasion, format, ownerFeedback: feedback,
        }, s.ai.textModel));
        if (!provider.isDryRun) await recordUsage({ jobId, provider: provider.name, model: out.model, kind: 'text', inputTokens: out.usage.inputTokens, outputTokens: out.usage.outputTokens, costUsd: estimateTextCost(s, out.usage.inputTokens, out.usage.outputTokens) });
        return out;
      });
      const fp = ideaFingerprint(product.slug, r.brief.idea, r.brief.ideaKey);
      const dups = await findDuplicates(account.id, { idea: fp, headline: r.brief.headline }, s.duplicateWindowDays, ad.id);
      const banned = findBanned([r.brief.idea, r.brief.headline, r.brief.badge, r.brief.supportingCopy, r.brief.caption, r.brief.sceneDescription].filter(Boolean).join('\n'), s.ai.bannedPhrases);
      if (banned.length) { avoidHeadlines.unshift(...banned, r.brief.headline); avoidIdeas.unshift(r.brief.idea); continue; } // rewrite: a banned slogan leaked
      if (dups.length === 0) { brief = r.brief; ideaFp = fp; }
      else { avoidIdeas.unshift(r.brief.ideaKey, r.brief.idea); avoidHeadlines.unshift(r.brief.headline); }
    }
    if (!brief) throw new AppError('NO_UNIQUE_IDEA', 'تعذر إيجاد فكرة إعلانية غير مكررة خلال فترة المنع لهذا الحساب.', 409);
    // STEP 07 auto-fix: a caption without a call to action gets the official one + the verified branch numbers
    if (captionIssues(brief.caption, { cta: ctaFor(business, lang), hashtags: brief.hashtags }).some((x) => x.includes('دعوة'))) {
      brief = { ...brief, caption: `${brief.caption.trim()}\n\n${ctaFor(business, lang)} 📞 ${contactLines(business, lang).map((c) => `${c.label} ${c.phone}`).join(' · ')}` };
    }
    // ── AI PROOFREADING (optional, `useAiReview`): definite spelling/grammar mistakes fixed BEFORE the design is drawn ──
    let proof: { applied: ProofIssue[]; flagged: ProofIssue[]; error?: string } | null = null;
    if (s.ai.useAiReview && !provider.isDryRun && provider.generateJson) {
      try {
        await assertBudget(s, estimateTextCost(s, 1200, 300));
        const copy: ProofCopy = { headline: brief.headline, badge: brief.badge, supportingCopy: brief.supportingCopy, cta: brief.cta, caption: brief.caption };
        const r = await provider.generateJson(PROOF_SYSTEM, JSON.stringify({ language: lang, ...copy }), s.ai.textModel);
        await recordUsage({ provider: provider.name, model: r.model, kind: 'text', inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, costUsd: estimateTextCost(s, r.usage.inputTokens, r.usage.outputTokens) });
        const fixed = applyProofIssues(copy, r.json);
        brief = { ...brief, headline: fixed.copy.headline ?? brief.headline, badge: fixed.copy.badge ?? brief.badge, supportingCopy: fixed.copy.supportingCopy ?? brief.supportingCopy, cta: fixed.copy.cta ?? brief.cta, caption: fixed.copy.caption ?? brief.caption };
        proof = { applied: fixed.applied, flagged: fixed.flagged };
      } catch (e) { proof = { applied: [], flagged: [], error: (e as Error).message.slice(0, 160) }; }
    }
    // ── ALGORITHM GATE: the design is BUILT to the algorithm index, not just scored afterwards — bait removed, first line
    // visible before «more», product keyword + place in the first two lines, a natural send/save line, 3–5 hashtags ──
    const algoFit: AlgoFit = fitToAlgorithm({
      format, lang, caption: brief.caption, hashtags: brief.hashtags, headline: brief.headline,
      keyword: lang === 'en' ? (product.titleEn ?? product.titleAr) : product.titleAr, market: marketOf(account) === 'KSA' ? 'KSA' : 'BH',
      reelSeconds: format === 'REEL_VIDEO' ? reelDuration : null, slides: format === 'IMAGE_CAROUSEL' ? (brief.slides?.length ?? 0) + 2 : undefined,
    });
    brief = { ...brief, caption: algoFit.caption, hashtags: algoFit.hashtags };
    {
      const o = (await prisma.advertisement.findUniqueOrThrow({ where: { id: ad.id }, select: { options: true } })).options as Record<string, unknown> | null;
      await prisma.advertisement.update({ where: { id: ad.id }, data: { options: { ...(o ?? {}), algorithm: { before: algoFit.before, after: algoFit.after, grade: algoFit.grade, fixes: algoFit.fixes, remaining: algoFit.remaining }, ...(proof ? { aiProofread: proof } : {}) } as unknown as Prisma.InputJsonValue } });
    }

    const briefRow = await prisma.creativeBrief.create({
      data: {
        accountId: account.id, productId: product.id, language: lang, ideaKey: brief.ideaKey, idea: brief.idea, audience: brief.audience,
        occasion: brief.occasion, sceneDescription: brief.sceneDescription, headline: brief.headline, supportingCopy: brief.supportingCopy || null,
        cta: brief.cta || ctaFor(business, lang), caption: brief.caption, hashtags: brief.hashtags, styleNotes: brief.styleNotes,
        rawJson: { ...brief, direction: p.direction ?? null } as unknown as Prisma.InputJsonValue, provider: provider.name,
      },
    });

    // ── Step 7: AI scene (no text, no logo) ──
    let artDirector: { candidates: number; best: number; scores: number[]; reason: string } | null = null;
    let textCheck: { attempts: number; passed: boolean; textPassed?: boolean; missing: string[]; foreign?: string[]; layoutIssues?: string[] } | null = null;
    await assertBudget(s, estimateImageCost(s, imgQuality));
    // a phrase the owner put in quotes («…» / "…") must appear letter-for-letter (e.g. printed on the mug) and is spell-checked too
    const quoted = quotedPhrases(d.idea);
    // reference images: the REAL product photo + the owner's reference design (every mode: full-AI posters take its whole
    // look, layered designs take its photographic look — lighting, palette, mood, background — under the system's layout)
    const refs: { role: 'product' | 'style'; png: Buffer }[] = [];
    if (s.ai.useReferences && !provider.isDryRun && !d.realPhotoKey) {
      const photo = await loadReference(product.photoKey);
      if (photo) refs.push({ role: 'product', png: photo });
    }
    const styleBrief = s.ai.useReferences && !d.realPhotoKey ? await styleBriefFor(s, provider, format) : '';
    if (s.ai.useReferences && s.ai.styleRefImage && !provider.isDryRun && !d.realPhotoKey) {
      const style = await loadReference(styleKeyFor(s, format));
      if (style) refs.push({ role: 'style', png: style });
    }
    const refPrompt = referencePrompt(refs, styleBrief, aiFull ? 'poster' : 'scene'), references = refs.length ? refs.map((r) => r.png) : undefined;
    const realPhoto = d.realPhotoKey ? await loadReference(d.realPhotoKey) : null;
    if (d.realPhotoKey && !realPhoto) throw new AppError('NO_PHOTO', 'صورة العمل المنجز غير موجودة — ارفعها مرة أخرى.', 422);
    type Scene = Awaited<ReturnType<typeof provider.generateScene>>;
    // ── IMAGE QUALITY GATE (layered scenes + reel shots): text drawn by mistake, softness, exposure ──
    const gateOn = s.ai.imageQualityGate && !provider.isDryRun && !realPhoto;
    const qualities: ImageQuality[] = [];
    let gateRetried = false, chosenQ: ImageQuality | null = null;
    const assessScene = async (png: Buffer, jobId?: string) => assessImage(png, {
      readText: provider.readText ? async (jpg: Buffer) => {
        await assertBudget(s, estimateTextCost(s, 1200, 120));
        const r = await provider.readText!(jpg, s.ai.textModel);
        await recordUsage({ jobId, provider: provider.name, model: r.model, kind: 'text', inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, costUsd: estimateTextCost(s, r.usage.inputTokens, r.usage.outputTokens) });
        return r.text;
      } : null,
    });
    const sceneFirst: Scene = realPhoto
      ? ({ png: await sharp(realPhoto).resize(1024, 1536, { fit: 'cover', position: sharp.strategy.attention }).png().toBuffer(), model: 'real-photo' } as Scene)
      : await withAiJob(ad.id, 'IMAGE', provider, s.ai.imageModel, async (jobId) => {
      const basePrompt = aiFull
        ? fullPosterPrompt({ lang, headline: brief!.headline, badge: brief!.badge, support: brief!.supportingCopy, features: [] /* typeset by the system in its own row */, sceneDescription: brief!.sceneDescription + (dtype ? ` Composition: ${dtype.prompt}.` : ''), style: creativeStyle, customPrompt: d.customPrompt, layout: POSTER_LAYOUTS.find((x) => x.value === art.poster)?.prompt, decor: palette?.decor ?? THEME_DECOR[style?.theme ?? 'navy_gold'], signature: signature ? signaturePoster({ bahrain: marketOf(account) !== 'KSA' }) : undefined, lighting: lightingP, lens: lensP, concept: conceptP, productText: quoted, aspect: posterSize === '1024x1024' ? 'square' : 'portrait', ...(({ topPct, bottomPct, safeWidthPct }) => ({ topPct, bottomPct, safeWidthPct }))(aiPosterGeometry(FORMAT_SIZE[format].h)) })
        : scenePrompt(brief!.sceneDescription + (dtype ? ` Composition: ${dtype.prompt}.` : ''), creativeStyle, { lighting: lightingP, lens: lensP, concept: conceptP });
      const prompt = refPrompt ? `${basePrompt}\n${refPrompt}` : basePrompt;
      // Art director (bestOf > 1): several candidates, a vision judge keeps the strongest one
      const n = !provider.isDryRun && provider.judgeImages ? s.ai.bestOf : 1;
      const candidates: Awaited<ReturnType<typeof provider.generateScene>>[] = [];
      for (let k = 0; k < n; k++) {
        if (k > 0) await assertBudget(s, estimateImageCost(s, imgQuality));
        const img = await retrying(s.ai.maxRetries, () => provider.generateScene(prompt, { model: s.ai.imageModel, quality: imgQuality, size: aiFull ? posterSize : '1024x1536', seedHint: `${ad.id}${k ? `-c${k}` : ''}`, references }));
        if (!provider.isDryRun) await recordUsage({ jobId, provider: provider.name, model: img.model, kind: 'image', images: 1, costUsd: estimateImageCost(s, imgQuality) });
        candidates.push(img);
        if (gateOn && !aiFull) {
          let q = await assessScene(img.png, jobId); qualities.push(q);
          // one corrective re-draw per design: the reason goes into the prompt (only within the AI budget)
          if (!q.pass && !gateRetried) {
            gateRetried = true;
            try {
              await assertBudget(s, estimateImageCost(s, imgQuality));
              const again = await retrying(s.ai.maxRetries, () => provider.generateScene(prompt + retryHint(q), { model: s.ai.imageModel, quality: imgQuality, size: '1024x1536', seedHint: `${ad.id}-q${k}`, references }));
              await recordUsage({ jobId, provider: provider.name, model: again.model, kind: 'image', images: 1, costUsd: estimateImageCost(s, imgQuality) });
              q = await assessScene(again.png, jobId); candidates.push(again); qualities.push(q);
            } catch { /* budget reached → keep the best attempt; QC shows the issue */ }
          }
        }
      }
      // the quality gate decides which candidates the art director may choose from: passing ones, else the best-scoring
      if (gateOn && !aiFull && qualities.length === candidates.length) {
        const ok = candidates.filter((_, i) => qualities[i].pass);
        const bestI = qualities.reduce((b, q, i) => (q.score > qualities[b].score ? i : b), 0);
        const keep = ok.length ? ok : [candidates[bestI]];
        const keptQ = ok.length ? qualities.filter((q) => q.pass) : [qualities[bestI]];
        candidates.splice(0, candidates.length, ...keep);
        qualities.splice(0, qualities.length, ...keptQ);
      }
      // Self-correcting full-AI poster: read the drawn text BEFORE composing; misspelled/missing words → re-draw with an exact correction note
      let pool = candidates;
      if (aiFull && provider.readText && !provider.isDryRun) {
        const expected = [brief!.headline, brief!.badge, brief!.supportingCopy ?? '', ...quoted].filter((x) => x.trim());
        const zoneBottom = aiPosterGeometry(FORMAT_SIZE[format].h).bottomPct;
        const spell = async (c: (typeof candidates)[number]) => {
          try {
            await assertBudget(s, estimateTextCost(s, 1500, 260));
            const jpg = await sharp(c.png).jpeg({ quality: 85 }).toBuffer();
            // one vision pass: drawn text + layout (product complete, reserved bottom zone free); older providers: text only
            const insp = provider.inspectPoster ? await provider.inspectPoster(jpg, s.ai.textModel, { bottomPct: zoneBottom, productHint: product.titleEn }) : null;
            const rt = insp ?? await provider.readText!(jpg, s.ai.textModel);
            await recordUsage({ jobId, provider: provider.name, model: rt.model, kind: 'text', inputTokens: rt.usage.inputTokens, outputTokens: rt.usage.outputTokens, costUsd: estimateTextCost(s, rt.usage.inputTokens, rt.usage.outputTokens) });
            const t = aiTextCheck(expected, rt.text, [...(s.brandFeatures[lang] ?? []), product.titleAr, product.titleEn]);
            const layoutIssues = insp ? [...(!insp.layout.productVisible ? ['product not fully visible'] : []), ...(!insp.layout.bottomClear ? [`objects or text inside the bottom ${zoneBottom}%`] : []), ...(!insp.layout.productVisible || !insp.layout.bottomClear ? insp.layout.issues : [])] : [];
            return { ...t, textOk: t.ok, layoutIssues, ok: t.ok && layoutIssues.length === 0 };
          } catch { return null; } // reading unavailable → no correction loop, QC still asks a human
        };
        const checks = await Promise.all(candidates.map(spell));
        for (let r = 0; r < s.ai.aiFullTextRetries && checks.every((c) => c && !c.ok); r++) {
          await assertBudget(s, estimateImageCost(s, imgQuality));
          const wrong = [...new Set(checks.flatMap((c) => c?.missing ?? []))];
          const extra = [...new Set(checks.flatMap((c) => c?.foreign ?? []))].slice(0, 4);
          const layout = [...new Set(checks.flatMap((c) => c?.layoutIssues ?? []))].slice(0, 5);
          const textBad = checks.some((c) => c && !c.textOk);
          const fix = [prompt,
            textBad ? `SPELLING CORRECTION (attempt ${r + 2}): the previous image drew ${wrong.length ? `these texts wrongly or not at all: ${wrong.map((w) => `«${w}»`).join(', ')}` : 'illegible letters'}. Draw EXACTLY these texts, letter by letter, in correct ${lang === 'ar' ? 'Arabic' : lang === 'ml' ? 'Malayalam' : 'English'} spelling, large and clear: ${expected.map((e) => `«${e}»`).join(' · ')}. Fewer, bigger words are better than small text.${extra.length ? ` REMOVE this text completely — it does not belong to this advertisement (not on the product, not anywhere): ${extra.map((w) => `«${w}»`).join(', ')}.` : ''}` : '',
            layout.length ? `LAYOUT CORRECTION (attempt ${r + 2}): the previous image had these problems: ${layout.join('; ')}. Show the hero product COMPLETE and sharp in the middle of the poster, fully inside the frame, and keep the bottom ${zoneBottom}% as plain background only (the order button and phone panel cover it).` : '',
          ].filter(Boolean).join('\n');
          const img = await retrying(s.ai.maxRetries, () => provider.generateScene(fix, { model: s.ai.imageModel, quality: imgQuality, size: posterSize, seedHint: `${ad.id}-fix${r}`, references }));
          await recordUsage({ jobId, provider: provider.name, model: img.model, kind: 'image', images: 1, costUsd: estimateImageCost(s, imgQuality) });
          candidates.push(img); checks.push(await spell(img));
        }
        const passing = candidates.filter((_, i) => checks[i]?.ok);
        const bad = (c: (typeof checks)[number]) => (c ? c.missing.length * 2 + c.foreign.length * 2 + c.layoutIssues.length : 99);
        const fewest = checks.reduce((b, c, i) => (bad(c) < bad(checks[b]) ? i : b), 0);
        pool = passing.length ? passing : [candidates[fewest]];
        textCheck = { attempts: candidates.length, passed: passing.length > 0, textPassed: passing.length > 0 || !!checks[fewest]?.textOk, missing: passing.length ? [] : (checks[fewest]?.missing ?? []), ...(passing.length ? {} : { foreign: checks[fewest]?.foreign ?? [], layoutIssues: checks[fewest]?.layoutIssues ?? [] }) };
      }
      if (pool.length === 1) { chosenQ = qualities[0] ?? null; return pool[0]; }
      try {
        const thumbs = await Promise.all(pool.map((c) => sharp(c.png).resize(512).jpeg({ quality: 80 }).toBuffer()));
        const j = await provider.judgeImages!(thumbs, `${brief!.headline} — ${brief!.sceneDescription}${styleBrief ? ` — prefer the candidate closest to the owner's target style: ${styleBrief}` : ''}`.slice(0, 1800), s.ai.textModel);
        await recordUsage({ jobId, provider: provider.name, model: j.model, kind: 'text', inputTokens: j.usage.inputTokens, outputTokens: j.usage.outputTokens, costUsd: estimateTextCost(s, j.usage.inputTokens, j.usage.outputTokens) });
        artDirector = { candidates: pool.length, best: j.best, scores: j.scores, reason: j.reason };
        chosenQ = qualities[j.best] ?? qualities[0] ?? null;
        return pool[j.best] ?? pool[0];
      } catch (e) {
        artDirector = { candidates: pool.length, best: 0, scores: [], reason: `judge failed: ${(e as Error).message.slice(0, 120)}` };
        chosenQ = qualities[0] ?? null;
        return pool[0];
      }
    });

    // ── STEP 07: drawn text still unverified after the re-draws → never ship it: re-render with system-typeset Arabic ──
    let textFallback = false;
    let scene = sceneFirst;
    if (aiFull && (textCheck as { textPassed?: boolean } | null)?.textPassed === false && s.ai.verifiedTextFallback) {
      await assertBudget(s, estimateImageCost(s, imgQuality));
      scene = await withAiJob(ad.id, 'IMAGE', provider, s.ai.imageModel, async (jobId) => {
        const img = await retrying(s.ai.maxRetries, () => provider.generateScene(scenePrompt(brief!.sceneDescription + (dtype ? ` Composition: ${dtype.prompt}.` : ''), creativeStyle, { lighting: lightingP, lens: lensP, concept: conceptP }) + (refPrompt ? `\n${refPrompt}` : ''), { model: s.ai.imageModel, quality: imgQuality, size: '1024x1536', seedHint: `${ad.id}-verified`, references }));
        await recordUsage({ jobId, provider: provider.name, model: img.model, kind: 'image', images: 1, costUsd: estimateImageCost(s, imgQuality) });
        return img;
      });
      aiFull = false; textFallback = true;
    }
    if (artDirector || textCheck || refs.length || styleBrief || conceptSelection || textFallback) {
      const cur = (await prisma.advertisement.findUniqueOrThrow({ where: { id: ad.id }, select: { options: true } })).options as Record<string, unknown> | null;
      await prisma.advertisement.update({ where: { id: ad.id }, data: { options: { ...(cur ?? {}), ...(artDirector ? { artDirector } : {}), ...(textCheck ? { aiTextCheck: textCheck } : {}), ...(conceptSelection ? { conceptSelection } : {}), ...(textFallback ? { verifiedTextFallback: true, renderModeUsed: 'layered' } : {}), ...(refs.length || styleBrief ? { references: [...new Set([...refs.map((r) => r.role), ...(styleBrief ? ['style'] : [])])] } : {}) } as Prisma.InputJsonValue } });
    }

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
    // the idea's own storyboard (hook → context → product → benefit); generic angles only as a fallback
    const story = (brief.storyboard ?? []).filter((x) => x.scene.trim());
    const shotFor = (i: number) => (story[i]?.scene ? `${story[i].scene} Same product as the first shot: ${brief!.sceneDescription.slice(0, 300)}` : `${brief!.sceneDescription} ${SHOTS[(i - 1) % SHOTS.length]}`);
    const extraScenes: { png: Buffer; model: string }[] = [];
    const shotQualities: ImageQuality[] = []; let shotRetries = 0;
    for (let i = 1; i < sceneCount; i++) {
      await assertBudget(s, estimateImageCost(s, imgQuality));
      extraScenes.push(await withAiJob(ad.id, 'IMAGE', provider, s.ai.imageModel, async (jobId) => {
        const shotPrompt = scenePrompt(`${shotFor(i)}`, creativeStyle, { lighting: lightingP, concept: conceptP });
        let img = await retrying(s.ai.maxRetries, () => provider.generateScene(shotPrompt, { model: s.ai.imageModel, quality: imgQuality, size: '1024x1536', seedHint: `${ad.id}-${i}` }));
        if (!provider.isDryRun) await recordUsage({ jobId, provider: provider.name, model: img.model, kind: 'image', images: 1, costUsd: estimateImageCost(s, imgQuality) });
        if (gateOn) {
          let q = await assessScene(img.png, jobId);
          if (!q.pass) {
            try {
              await assertBudget(s, estimateImageCost(s, imgQuality));
              const again = await retrying(s.ai.maxRetries, () => provider.generateScene(shotPrompt + retryHint(q), { model: s.ai.imageModel, quality: imgQuality, size: '1024x1536', seedHint: `${ad.id}-${i}-q` }));
              await recordUsage({ jobId, provider: provider.name, model: again.model, kind: 'image', images: 1, costUsd: estimateImageCost(s, imgQuality) });
              const q2 = await assessScene(again.png, jobId); shotRetries++;
              if (q2.score >= q.score) { img = again; q = q2; }
            } catch { /* budget reached → keep the first shot */ }
          }
          shotQualities.push(q);
        }
        return img;
      }));
    }
    const extraBackgrounds = await Promise.all(extraScenes.map((x) => buildBackground(x.png, format, composed.templateKey, contactLines(business, lang).length, style?.theme, features.length)));
    const jpeg = await toJpeg(composed.png);

    // ── Carousel: teaching slides + save/CTA slide (same theme, product backdrop, contacts on every slide) ──
    let carousel: Awaited<ReturnType<typeof renderCarousel>> | null = null;
    if (format === 'IMAGE_CAROUSEL') carousel = await renderCarousel(composed, scene.png, normaliseSlides(brief.slides, lang), lang, { photos: !aiFull });

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
        let displayScript = '';
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
          let pronunciation: { accuracy: number | null; takes: number; pace: string; missed?: string[] } | null = null;
          try {
            if (provider.writeVoiceover) {
              const w = await provider.writeVoiceover({ language: vlang.prompt, persona: persona.acting, seconds, maxWords, storyboard: (brief.storyboard ?? []).map((x) => `${x.beat}: ${x.scene.slice(0, 160)}`), copy: { headline: brief.headline, badge: brief.badge, support: brief.supportingCopy, cta, caption: brief.caption }, product: { titleEn: product.titleEn, titleAr: product.titleAr } }, s.ai.textModel);
              if (!provider.isDryRun) await recordUsage({ provider: provider.name, model: w.model, kind: 'text', inputTokens: w.usage.inputTokens, outputTokens: w.usage.outputTokens, costUsd: estimateTextCost(s, w.usage.inputTokens, w.usage.outputTokens) });
              script = sanitizeScript(w.script, maxWords) ?? script; // rule-breaking script → verified copy instead
            }
            if (provider.isDryRun) { voice = fakeSpeech(script); displayScript = script; }
            else {
              const key = await getSecret('OPENAI_API_KEY');
              if (!key) throw new Error('مفتاح OpenAI غير مضبوط');
              // what the voice reads: the pronunciation lexicon (built-in + owner's) applied to the script
              displayScript = script; // captions show the script as written (the lexicon only changes what the voice reads)
              const spoken = applyLexicon(script, s.ai.audio.lexicon);
              const r = await speakVerified(spoken, {
                pace: s.ai.audio.pace === 'slow' ? 'slow' : 'normal',
                speak: async (text, pace, note) => {
                  const v = await openaiSpeak(key, text, { persona, lang: vlang, pace: pace === 'slow' ? 'slow' : s.ai.audio.pace, note });
                  await recordUsage({ provider: 'openai', model: v.model, kind: 'audio', costUsd: estimateTtsCost(v.chars) });
                  return v.audio;
                },
                transcribe: s.ai.audio.verifyPronunciation ? async (a) => {
                  const t = await openaiTranscribe(key, a, sttLang(vlang.id));
                  await recordUsage({ provider: 'openai', model: 'gpt-4o-mini-transcribe', kind: 'audio', costUsd: estimateSttCost(seconds) });
                  return t;
                } : undefined,
              });
              voice = r.best.audio;
              pronunciation = { accuracy: r.best.accuracy, takes: r.takes.length, pace: r.best.pace, ...(r.best.accuracy !== null && r.best.accuracy < 0.85 ? { missed: missedWords(spoken, r.best.heard ?? '') } : {}) };
              script = spoken;
            }
            audioNote = { voiceScript: script, persona: persona.id, voiceLang: vlang.id, ...(pronunciation ? { pronunciation } : {}) };
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
          ...(voice && displayScript && s.ai.audio.captions ? { captions: { text: displayScript, lang } } : {}),
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
    // lossless PNG master next to the published JPEG (STEP 08 export); not a media asset, so publishing is unchanged
    await storage().put(`${base}/final.png`, composed.png, 'image/png');
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

    // the picture quality behind this design (shown on the design page and in QC)
    const cq = chosenQ as ImageQuality | null; // set inside the image job above
    const imageQuality = gateOn && (cq || shotQualities.length) ? {
      score: Math.min(cq?.score ?? 100, ...shotQualities.map((q) => q.score)),
      pass: (cq?.pass ?? true) && shotQualities.every((q) => q.pass),
      issues: [...new Set([...(cq?.issues ?? []), ...shotQualities.flatMap((q) => q.issues)].map((i) => `${i.level === 'fail' ? '✗' : '•'} ${i.ar}`))].slice(0, 8),
      sharpness: cq?.sharpness ?? null, retried: (gateRetried ? 1 : 0) + shotRetries, checked: qualities.length + shotQualities.length,
    } : null;
    if (imageQuality) {
      const o = (await prisma.advertisement.findUniqueOrThrow({ where: { id: ad.id }, select: { options: true } })).options as Record<string, unknown> | null;
      await prisma.advertisement.update({ where: { id: ad.id }, data: { options: { ...(o ?? {}), imageQuality } as Prisma.InputJsonValue } });
    }

    // ── Step 10: automated quality control ──
    const dups = await findDuplicates(account.id, { sha256: primarySha, phash: finalHash, headline: brief.headline }, s.duplicateWindowDays, ad.id);
    const qc = await runQualityChecks({
      lang, format, headline: brief.headline, badge: brief.badge, supportingCopy: brief.supportingCopy, cta, caption: brief.caption, hashtags: brief.hashtags,
      manifest: composed.manifest, background: composed.background, finalImage: jpeg, logoPng: composed.layers.find((l) => l.id === 'logo')!.png,
      usedLogoSha: logo.sha256, approvedLogoSha: (await loadApprovedLogo(business.id)).sha256,
      approvedPhones: locationsOf(business).map((l) => ({ key: l.key, phone: l.phone })),
      productAllowed: productAllowed(account, product), duplicates: dups, dryRun: provider.isDryRun,
      video: video?.probe ?? null, videoError, aiText, aiTextNeedsHuman: s.ai.aiFullRequiresApproval, voicePronunciation: (audioNote?.pronunciation as { accuracy: number | null; missed?: string[] } | undefined) ?? null, ...(aiFull && textCheck ? { aiLayoutIssues: (textCheck as { layoutIssues?: string[] }).layoutIssues ?? [] } : {}),
      carousel: carousel ? { images: carousel.slides.length + 1, problems: carousel.problems } : null,
      aiVideo: engine === 'veo' ? { used: !!veo, model: veo?.model ?? null, note: aiVideoNote } : null,
      algorithm: { score: algoFit.after, grade: algoFit.grade, remaining: algoFit.remaining.map((r) => r.label) },
      aiProofread: proof,
      imageQuality,
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
export async function pickArt(accountId: string, o: { aiFull: boolean; composition?: string; light?: boolean; concept?: string; concepts?: boolean; formal?: boolean; blockedConcepts?: string[]; prefer?: { concept?: string; lighting?: string; composition?: string } }): Promise<Art> {
  // 🎨 visual memory: a winner the account brain learnt is used when it is allowed here; otherwise least-recently-used
  const pref = (pool: readonly string[], v?: string) => (v && pool.includes(v) ? v : undefined);
  const recent = await prisma.advertisement.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' }, take: 12, select: { options: true } });
  const prev = recent.map((r) => ((r.options ?? {}) as { direction?: { art?: Art } | null }).direction?.art ?? {});
  const comps = o.aiFull ? DESIGN_TYPES.map((x) => x.value) : LAYERED_COMPOSITIONS;
  const lights = LIGHTING.filter((x) => o.light === undefined || x.light === o.light).map((x) => x.value);
  let lenses = LENSES.map((x) => x.value) as string[];
  const composition = o.composition ?? pref(comps, o.prefer?.composition) ?? pickLeastRecent(comps, prev.map((a) => a.composition ?? null));
  if (composition === 'flat_lay') lenses = ['overhead'];
  else lenses = lenses.filter((l) => l !== 'overhead' && (composition !== 'macro_detail' || l === '85mm' || l === '50mm'));
  return {
    composition,
    lighting: pref(lights, o.prefer?.lighting) ?? pickLeastRecent(lights, prev.map((a) => a.lighting ?? null)),
    lens: pickLeastRecent(lenses, prev.map((a) => a.lens ?? null)),
    ...(o.aiFull ? { poster: pickLeastRecent(POSTER_LAYOUTS.map((x) => x.value), prev.map((a) => a.poster ?? null)) } : {}),
    ...conceptOf(o, prev),
  };
}

/**
 * Automatic Google Business Profile: adds the «gmb» channel (a separate Google-safe satellite post: no phones,
 * no hashtags, local branch line) when the account opted in, GBP is linked to the brand in Metricool, the format
 * suits Google (feed / square image, or a reel → profile gallery) and the weekly cadence isn't reached yet.
 */
export async function withAutoGbp(account: { id: string; platform: import('@prisma/client').SocialPlatform; gbpAuto: boolean; gbpPerWeek: number; connection: { providerSnapshot: unknown } | null }, format: MediaFormat, channels: import('@prisma/client').SocialPlatform[]): Promise<import('@prisma/client').SocialPlatform[]> {
  if (!account.gbpAuto || channels.includes('gmb') || !['IMAGE_FEED', 'IMAGE_SQUARE', 'REEL_VIDEO'].includes(format)) return channels;
  const linked = ((account.connection?.providerSnapshot as { networks?: { network: string }[] } | null)?.networks ?? []).map((n) => n.network);
  if (!linked.includes('gmb')) return channels;
  const week = await prisma.advertisement.count({ where: { accountId: account.id, channels: { has: 'gmb' }, createdAt: { gte: new Date(Date.now() - 7 * 86400_000) }, state: { notIn: ['REJECTED', 'FAILED'] } } });
  if (week >= account.gbpPerWeek) return channels;
  return [...(channels.length ? channels : [account.platform]), 'gmb' as const];
}

/** Adds the account's automatic channels (linked + format-compatible) to the chosen ones; the own platform stays first. */
export function withAutoChannels(account: Parameters<typeof autoChannelsFor>[0], format: MediaFormat, chosen: import('@prisma/client').SocialPlatform[]): import('@prisma/client').SocialPlatform[] {
  const extra = autoChannelsFor(account, format);
  if (!extra.length) return chosen;
  const base = chosen.length ? chosen : [account.platform];
  return [...new Set([...base, ...extra])];
}

/** Big visual idea: user choice, «none», or least-recently-used (formal accounts only get formal concepts). Macro shots keep the pure product look. */
function conceptOf(o: { composition?: string; concept?: string; concepts?: boolean; formal?: boolean; blockedConcepts?: string[]; prefer?: { concept?: string } }, prev: Art[]): { concept?: string } {
  if (o.concept === 'none') return {};
  if (o.concept && o.concept !== 'auto') return CONCEPTS.some((c) => c.value === o.concept) ? { concept: o.concept } : {};
  if (o.concepts === false || o.composition === 'macro_detail') return {};
  const pool = withoutBlocked(CONCEPTS.filter((c) => !o.formal || c.formal).map((c) => c.value as string), o.blockedConcepts ?? []);
  return { concept: (o.prefer?.concept && pool.includes(o.prefer.concept) ? o.prefer.concept : undefined) ?? pickLeastRecent(pool, prev.map((a) => a.concept ?? null)) };
}

/** Exact phrases the owner quoted in the idea («…», "…", “…”) — max 2, 3–120 characters each. */
export function quotedPhrases(idea?: string | null): string[] {
  if (!idea) return [];
  const out: string[] = [];
  for (const m of idea.matchAll(/[«"“]([^«»"“”]{3,120})[»"”]/g)) { const t = m[1].trim().replace(/[.،,]+$/, ''); if (t && !out.includes(t)) out.push(t); }
  return out.slice(0, 2);
}

/** The stored reference design for a format: its own slot first (story/reel, feed, square, carousel), then the general one. */
function styleKeyFor(s: Settings, format: string): string | null {
  const slot = slotsFor(format).find((k) => s.ai.styleRefsByFormat[k]?.key);
  return slot ? s.ai.styleRefsByFormat[slot]!.key : s.ai.styleReferenceKey;
}

/** The reference design's style as words; made once (also for designs uploaded before this existed) and cached in settings. */
async function styleBriefFor(s: Settings, provider: AiProvider, format: string): Promise<string> {
  // the format's own reference first (story/reel, feed, square, carousel), then the general one
  const slot = slotsFor(format).find((k) => s.ai.styleRefsByFormat[k]?.key);
  const ref = slot ? s.ai.styleRefsByFormat[slot]! : { key: s.ai.styleReferenceKey, brief: s.ai.styleReferenceBrief };
  if (ref.brief.trim() || !ref.key || provider.isDryRun || !provider.describeStyle) return ref.brief;
  const png = await loadReference(ref.key);
  if (!png) return '';
  try {
    await assertBudget(s, estimateTextCost(s, 1500, 250));
    const r = await provider.describeStyle(png, s.ai.textModel);
    await recordUsage({ provider: provider.name, model: r.model, kind: 'text', inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, costUsd: estimateTextCost(s, r.usage.inputTokens, r.usage.outputTokens) });
    if (r.text) await updateSettings((x) => ({ ...x, ai: slot
      ? { ...x.ai, styleRefsByFormat: { ...x.ai.styleRefsByFormat, [slot]: { key: ref.key, brief: r.text } } }
      : { ...x.ai, styleReferenceBrief: r.text } }));
    return r.text;
  } catch { return ''; }
}

/** Resolves a campaign's multi-choice lists to one random value each (only where no single value was fixed). */
export async function pickFromChoices<T extends { productId?: string; format?: string; direction?: Direction }>(p: T, rnd: () => number = Math.random): Promise<T> {
  const d = p.direction;
  if (!d) return p;
  const one = <V>(xs: V[]) => xs[Math.floor(rnd() * xs.length)];
  let out: T = p;
  if (!p.productId && d.productIds?.length) {
    const active = await prisma.product.findMany({ where: { id: { in: d.productIds }, active: true }, select: { id: true } });
    if (active.length) out = { ...out, productId: one(active).id };
  }
  if (!out.productId && !d.categoryId && d.categoryIds?.length) out = { ...out, direction: { ...out.direction, categoryId: one(d.categoryIds) } };
  if (!p.format && d.formats?.length) out = { ...out, format: one(d.formats) };
  if (!d.contentType && d.contentTypes?.length) out = { ...out, direction: { ...out.direction, contentType: one(d.contentTypes) } };
  return out;
}
