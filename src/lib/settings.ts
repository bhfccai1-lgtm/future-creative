import { z } from 'zod';
import { prisma } from './db';
import { decryptSecret, encryptSecret } from './crypto';

/** Typed system settings with safe defaults. Initial state is deliberately conservative: MANUAL, auto-publishing off. */
export const SettingsSchema = z.object({
  publishingMode: z.enum(['MANUAL', 'ASSISTED', 'AUTONOMOUS']).default('MANUAL'),
  autonomousAuthorizedAt: z.string().nullable().default(null),
  autonomousAuthorizedBy: z.string().nullable().default(null),
  schedulerMode: z.enum(['A_PER_ACCOUNT_HOURLY', 'B_FIXED_PER_HOUR']).default('A_PER_ACCOUNT_HOURLY'),
  modeBPostsPerHour: z.number().int().min(1).max(100).default(3),
  modeBAccountIds: z.array(z.string()).default([]),
  autoPublishGlobal: z.boolean().default(false),
  killSwitch: z.boolean().default(false),
  publishing: z.object({
    /** false (V8 default): UNKNOWN submissions that are absent at the provider wait for an operator. */
    autoResubmitAfterAbsence: z.boolean().default(false),
    /** Minimum minutes between two posts on the same account (campaigns + automatic schedule + manual). */
    minGapMinutes: z.number().int().min(0).max(720).default(30),
    /** Same-brand cross-promotion: a new feed/reel/carousel is shared as a branded story on the accounts chosen per account. */
    crossPromo: z.object({ enabled: z.boolean().default(false), maxPerTargetPerDay: z.number().int().min(1).max(6).default(2), delayMinutes: z.number().int().min(0).max(720).default(45) }).prefault({}),
  }).prefault({}),
  killSwitchReason: z.string().nullable().default(null),
  /** Idea bank: weekly rated ideas per active account; approved ideas feed automatic generation. */
  /** occasions the owner switched off — never picked automatically, hidden from the calendar suggestions */
  disabledOccasions: z.array(z.string().max(60)).max(100).default([]),
  ideas: z.object({
    weekly: z.boolean().default(true),
    perAccount: z.number().int().min(1).max(6).default(5),
    useBank: z.boolean().default(true),
    /** auto-approve ideas the AI rates at least this high (0 = always review yourself) */
    autoApproveMinScore: z.number().min(0).max(10).default(0),
  }).prefault({}),
  /** Fast-reach engine: learned peak hours per account + boosting proven winners. Off by default. */
  growth: z.object({
    peakHours: z.object({
      enabled: z.boolean().default(false),
      /** wait up to this many hours for a peak hour inside the account window */
      maxDelayHours: z.number().int().min(1).max(6).default(3),
      /** how many peak hours per day (top ranked) */
      count: z.number().int().min(2).max(10).default(6),
    }).prefault({}),
    winners: z.object({
      enabled: z.boolean().default(false),
      /** reach at least this multiple of the account median (or top shares+saves) */
      minMultiple: z.number().min(1.2).max(10).default(2),
      maxPerWeek: z.number().int().min(1).max(14).default(3),
    }).prefault({}),
  }).prefault({}),
  duplicateWindowDays: z.number().int().min(1).max(365).default(30),
  scheduleLeadMinutes: z.number().int().min(5).max(240).default(20),
  /** Benefit badges shown on the gold poster design (admin-approved wording — keep them verifiable). */
  brandFeatures: z.object({
    ar: z.array(z.string().max(24)).max(4).default(['تصاميم مخصصة', 'جودة طباعة عالية', 'مناسبات خاصة', 'هدايا الشركات']),
    en: z.array(z.string().max(24)).max(4).default(['Custom designs', 'Premium print', 'Special occasions', 'Corporate gifts']),
    ml: z.array(z.string().max(32)).max(4).default(['കസ്റ്റം ഡിസൈനുകൾ', 'മികച്ച പ്രിന്റ്', 'പ്രത്യേക അവസരങ്ങൾ', 'കോർപ്പറേറ്റ് ഗിഫ്റ്റുകൾ']),
  }).prefault({}),
  ai: z.object({
    dryRun: z.boolean().default(true),
    textModel: z.string().default('gpt-4.1-mini'),
    imageModel: z.string().default('gpt-image-1'),
    imageQuality: z.enum(['low', 'medium', 'high']).default('medium'),
    /** Image quality per format ('' = use imageQuality). Stories live 24 h → low is enough by default. */
    qualityByFormat: z.object({
      IMAGE_STORY: z.enum(['', 'low', 'medium', 'high']).default('low'),
      IMAGE_FEED: z.enum(['', 'low', 'medium', 'high']).default(''),
      IMAGE_SQUARE: z.enum(['', 'low', 'medium', 'high']).default(''),
      IMAGE_CAROUSEL: z.enum(['', 'low', 'medium', 'high']).default(''),
      REEL_VIDEO: z.enum(['', 'low', 'medium', 'high']).default(''),
    }).prefault({}),
    monthlyBudgetUsd: z.number().min(0).default(50),
    alertThresholdPct: z.number().min(1).max(100).default(80),
    maxDailyAds: z.number().int().min(0).default(48),
    maxRetries: z.number().int().min(0).max(5).default(2),
    creativeStyle: z.string().default('Premium commercial product photography, cinematic lighting, deep navy and elegant gold accents, clean composition with negative space at top and bottom for text.'),
    languages: z.array(z.enum(['ar', 'en', 'ml'])).default(['ar', 'en', 'ml']),
    useAiReview: z.boolean().default(false),
    /** IMAGE QUALITY GATE for ad scenes (layered designs and reel shots): text drawn inside the picture, softness,
     *  exposure — a failed scene is regenerated once with the reason. One small vision call per picture. */
    imageQualityGate: z.boolean().default(true),
    /** Full-AI posters (AI-drawn text): require a human approval before publishing. Admin may turn it off. */
    aiFullRequiresApproval: z.boolean().default(true),
    /** Automatic designs (schedule, campaigns, n8n) that don't choose: design method and style. 'auto' method = full AI poster for vertical formats on approval-mode accounts, verified layers for autonomous ones. */
    autoRenderMode: z.enum(['auto', 'layered', 'ai_full']).default('auto'),
    autoDesignStyle: z.string().max(40).default('fc_signature'),
    /** owner's standing guidance for every design (taste), e.g. «ألوان فاتحة، بدون وجوه أشخاص» */
    ownerGuidance: z.string().max(600).default(''),
    /** phrases that must never appear in any idea/headline/caption/drawn text (a slogan that keeps leaking) */
    bannedPhrases: z.array(z.string().max(80)).max(30).default(['إذا ما صحتني القهوة']),
    /** reference design (storage key): every full-AI poster follows its style/quality level, never its texts */
    styleReferenceKey: z.string().max(200).nullable().default(null),
    /** the reference design's style in words (made once at upload) — this text, never the image, guides each poster */
    styleReferenceBrief: z.string().max(1500).default(''),
    /** a reference design per format group (vertical = story & reel, feed, square, carousel); falls back to the general one */
    styleRefsByFormat: z.partialRecord(z.enum(['vertical', 'feed', 'square', 'carousel']), z.object({ key: z.string().max(200).nullable().default(null), brief: z.string().max(1500).default('') })).prefault({}),
    /** send the real product photo + reference design to the image model (images.edit) */
    useReferences: z.boolean().default(true),
    /** big visual idea (CONCEPTS) rotated per account on top of the photo recipe */
    creativeConcepts: z.boolean().default(true),
    /** full-AI posters: re-draw up to N times when the machine-read text is misspelled/missing (each retry = 1 image + 1 read) */
    aiFullTextRetries: z.number().int().min(0).max(3).default(2),
    /** art director: generate N candidate images and keep the best (vision-scored). 1 = off. Each extra candidate costs one image. */
    bestOf: z.number().int().min(1).max(3).default(1),
    /** STEP 02: when no idea is given, 3 concepts are proposed and the strongest is picked by a documented rubric */
    conceptTournament: z.boolean().default(true),
    /** FreeLLMAPI (self-hosted, free provider tiers) — used ONLY for idea suggestions; copy, poster and text checks stay on OpenAI */
    freeLlm: z.object({ enabled: z.boolean().default(false), model: z.string().max(120).default('auto') }).prefault({}),
    /** full-AI text still wrong after the re-draws → re-render the design with system-typeset (verified) Arabic text */
    verifiedTextFallback: z.boolean().default(true),
    /** Reels video engine: FFmpeg motion from AI stills (free) or Google Gemini Veo AI video (paid per second). */
    video: z.object({
      engine: z.enum(['ffmpeg', 'veo']).default('ffmpeg'),
      veoModel: z.string().default('veo-3.1-fast-generate-preview'),
      veoDurationSec: z.union([z.literal(4), z.literal(6), z.literal(8)]).default(8),
      veoResolution: z.enum(['720p', '1080p']).default('720p'),
      /** USD per generated second — editable because Google pricing changes; verify on the Gemini pricing page. */
      veoPricePerSec: z.number().min(0).default(0.15),
      maxVeoPerDay: z.number().int().min(0).max(200).default(6),
      nativeAudio: z.boolean().default(true),
      /** If Veo fails, still deliver an FFmpeg reel (flagged in QC) instead of failing the design. */
      fallbackToFfmpeg: z.boolean().default(true),
    }).prefault({}),
    /** Reel sound: voice-over voice, synthesised sound effects, music level under the voice, default audio for reels. */
    audio: z.object({
      /** speaker persona id (see audio/voices.ts) or 'auto' = chosen from the product category */
      persona: z.string().max(40).default('auto'),
      /** voice-over language/dialect id or 'auto' = from the audience/market (Bahraini by default) */
      voiceLang: z.string().max(40).default('auto'),
      sfx: z.boolean().default(true),
      musicVolume: z.number().min(0.1).max(1).default(0.35),
      defaultReelAudio: z.enum(['none', 'ambient', 'upbeat', 'library', 'voiceover', 'instagram']).default('upbeat'),
      /** reading pace of the voice-over */
      pace: z.enum(['slow', 'normal', 'fast']).default('normal'),
      /** listen back to the generated voice (transcription) and re-take once when words were not clear */
      verifyPronunciation: z.boolean().default(true),
      /** burned-in captions of the voice-over on reels (muted viewing) */
      captions: z.boolean().default(true),
      /** owner's pronunciation dictionary: written form → how it must be read (diacritics / Arabic spelling) */
      lexicon: z.array(z.object({ from: z.string().min(1).max(60), to: z.string().min(1).max(80) })).max(150).default([]),
    }).prefault({}),
    // USD estimates — editable because provider pricing changes. Verify against current OpenAI pricing.
    pricing: z.object({
      textInputPer1M: z.number().default(0.4),
      textOutputPer1M: z.number().default(1.6),
      imageLow: z.number().default(0.016),
      imageMedium: z.number().default(0.063),
      imageHigh: z.number().default(0.25),
    }).prefault({}),
  }).prefault({}),
  /** n8n / automation: signed outbound events + token-authenticated inbound API. Off by default. */
  n8n: z.object({
    enabled: z.boolean().default(false),
    webhookUrl: z.string().default(''),
    events: z.array(z.string()).default(['ad.ready_for_review', 'publication.published', 'publication.failed', 'publication.unknown', 'connection.lost', 'report.weekly']),
    /** Allow approve/reject through the inbound API (e.g. Telegram buttons). Approval binding still applies. */
    allowInboundApprovals: z.boolean().default(false),
    /** Allow n8n to request new designs (they still go to the approval queue / normal publishing rules). */
    allowInboundGeneration: z.boolean().default(true),
    /** Allow n8n to pause/resume accounts (emergency stop from Telegram). */
    allowInboundControl: z.boolean().default(false),
    /** Remind about designs waiting for approval longer than this (hours); 0 = off. */
    approvalReminderHours: z.number().int().min(0).max(72).default(6),
    /** Telegram destination for the n8n templates (bot token is a secret; ids are not). */
    telegramChatId: z.string().default(''),
    telegramAllowedUserIds: z.string().default(''),
    /** Google Drive archive folder id and Google Sheets id for n8n templates 06 (archive) and 04 (ideas). Not secrets. */
    gdriveFolderId: z.string().default(''),
    gsheetId: z.string().default(''),
  }).prefault({}),
  /** WhatsApp: official Meta catalogue sync (Catalog Batch API) + a daily «status pack» delivered to Telegram for manual posting.
   *  WhatsApp has no official API for Status, so the system never posts to Status itself. */
  whatsapp: z.object({
    catalog: z.object({
      enabled: z.boolean().default(false),
      catalogId: z.string().regex(/^\d*$/).default(''),
      graphVersion: z.string().regex(/^v\d+\.\d+$/).default('v23.0'),
      /** products shown in the catalogue: all active, or only these categories */
      categoryIds: z.array(z.string()).default([]),
      autoSyncDaily: z.boolean().default(true),
      lastSyncAt: z.string().nullable().default(null),
      lastSyncOk: z.boolean().default(false),
      lastSyncMessage: z.string().nullable().default(null),
    }).prefault({}),
    /** WhatsApp numbers shown to customers (product page, catalogue text, status pack). Empty = the branch phones (+973). */
    numbers: z.array(z.object({
      label: z.string().min(1).max(40),
      /** international digits without + (e.g. 97333316319, 9665xxxxxxxx) */
      phone: z.string().regex(/^\d{10,15}$/),
      /** accounts whose posts/status use this number (empty = all) */
      accountIds: z.array(z.string()).default([]),
      showOnProductPage: z.boolean().default(true),
      inCatalog: z.boolean().default(true),
    })).max(10).default([]),
    statusPack: z.object({
      enabled: z.boolean().default(false),
      maxPerDay: z.number().int().min(1).max(10).default(3),
      /** accounts whose verified posts feed the pack (empty = all) */
      accountIds: z.array(z.string()).default([]),
    }).prefault({}),
  }).prefault({}),
  /** «المبيعات»: monthly target, quote defaults, reactivation of past customers. Prices are always typed by a person. */
  sales: z.object({
    monthlyTargetBhd: z.number().min(0).max(10_000_000).default(0),
    quoteValidityDays: z.number().int().min(1).max(90).default(7),
    quoteTerms: z.string().max(600).default('العرض صالح حتى التاريخ المذكور. يبدأ التنفيذ بعد اعتماد التصميم النهائي من العميل.'),
    reactivationDays: z.number().int().min(14).max(365).default(60),
  }).prefault({}),
  /** EDUCATION MASTER: the official lesson list of the current school year, typed from the student textbooks' contents */
  education: z.object({
    curriculumYear: z.string().max(20).default('2026-2027'),
    curriculum: z.array(z.object({ subject: z.string().max(60), grade: z.number().int().min(0).max(12), lessons: z.array(z.string().trim().min(1).max(160)).max(80), source: z.string().max(200).optional() })).max(200).default([]),
  }).prefault({}),
  /** PRINT DESIGN STUDIO: what the shop REALLY offers (everything else is shown disabled, never assumed) */
  print: z.object({
    disabledProducts: z.array(z.string().max(40)).max(300).default([]),
    disabledMaterials: z.array(z.string().max(40)).max(200).default([]),
    disabledFinishes: z.array(z.string().max(40)).max(200).default([]),
    disabledMethods: z.array(z.string().max(40)).max(100).default([]),
    /** PDF/X the printer requires — not produced by this system (reported NOT_VERIFIED) */
    pdfx: z.enum(['none', 'x1a', 'x4']).default('none'),
    /** file name of the printer's ICC profile in the fonts/profile dir; empty = built-in generic CMYK */
    iccProfile: z.string().max(120).default(''),
  }).prefault({}),
  metricool: z.object({
    userId: z.string().default(''),
    baseUrl: z.string().default('https://app.metricool.com/api'),
    lastCheckAt: z.string().nullable().default(null),
    lastCheckOk: z.boolean().default(false),
    lastCheckMessage: z.string().nullable().default(null),
    requestsPerMinute: z.number().int().min(1).max(600).default(30),
    /** Instagram/Facebook: put hashtags in the first comment instead of the caption. */
    hashtagsInFirstComment: z.boolean().default(false),
  }).prefault({}),
});
export type Settings = z.infer<typeof SettingsSchema>;

const KEY = 'system';

export async function getSettings(): Promise<Settings> {
  const row = await prisma.systemSetting.findUnique({ where: { key: KEY } });
  return SettingsSchema.parse(row?.value ?? {});
}

export async function updateSettings(patch: (s: Settings) => Settings, updatedBy?: string): Promise<Settings> {
  const next = SettingsSchema.parse(patch(await getSettings()));
  await prisma.systemSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: next as object, updatedBy },
    update: { value: next as object, updatedBy },
  });
  return next;
}

// ── Encrypted secrets (never sent to the browser) ──
export type SecretName = 'OPENAI_API_KEY' | 'FREELLM_API_KEY' | 'METRICOOL_API_TOKEN' | 'N8N_WEBHOOK_SECRET' | 'N8N_API_TOKEN' | 'GEMINI_API_KEY' | 'TELEGRAM_BOT_TOKEN' | 'GOOGLE_ARCHIVE_URL' | 'META_CATALOG_TOKEN' | 'META_COMMENTS_TOKEN';

export async function setSecret(name: SecretName, value: string | null, updatedBy?: string) {
  const key = `secret:${name}`;
  if (!value) { await prisma.systemSetting.deleteMany({ where: { key } }); return; }
  const enc = encryptSecret(value);
  await prisma.systemSetting.upsert({
    where: { key }, create: { key, value: { enc }, secret: true, updatedBy }, update: { value: { enc }, updatedBy },
  });
}

/** DB-stored secret wins; falls back to environment variable. */
export async function getSecret(name: SecretName): Promise<string | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: `secret:${name}` } });
  const enc = (row?.value as { enc?: string } | null)?.enc;
  if (enc) return decryptSecret(enc);
  return process.env[name] || null;
}

export async function secretStatus(name: SecretName) {
  const v = await getSecret(name);
  return { configured: !!v, last4: v ? v.slice(-4) : null };
}
