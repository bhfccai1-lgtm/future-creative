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
  killSwitchReason: z.string().nullable().default(null),
  duplicateWindowDays: z.number().int().min(1).max(365).default(30),
  scheduleLeadMinutes: z.number().int().min(5).max(240).default(20),
  /** Benefit badges shown on the gold poster design (admin-approved wording — keep them verifiable). */
  brandFeatures: z.object({
    ar: z.array(z.string().max(24)).max(4).default(['تصاميم مخصصة', 'جودة طباعة عالية', 'مناسبات خاصة', 'هدايا الشركات']),
    en: z.array(z.string().max(24)).max(4).default(['Custom designs', 'Premium print', 'Special occasions', 'Corporate gifts']),
    ml: z.array(z.string().max(32)).max(4).default(['കസ്റ്റം ഡിസൈനുകൾ', 'മികച്ച പ്രിന്റ്', 'പ്രത്യേക അവസരങ്ങൾ', 'കോർപ്പറേറ്റ് ഗിഫ്റ്റുകൾ']),
  }).default({}),
  ai: z.object({
    dryRun: z.boolean().default(true),
    textModel: z.string().default('gpt-4.1-mini'),
    imageModel: z.string().default('gpt-image-1'),
    imageQuality: z.enum(['low', 'medium', 'high']).default('medium'),
    monthlyBudgetUsd: z.number().min(0).default(50),
    alertThresholdPct: z.number().min(1).max(100).default(80),
    maxDailyAds: z.number().int().min(0).default(48),
    maxRetries: z.number().int().min(0).max(5).default(2),
    creativeStyle: z.string().default('Premium commercial product photography, cinematic lighting, deep navy and elegant gold accents, clean composition with negative space at top and bottom for text.'),
    languages: z.array(z.enum(['ar', 'en', 'ml'])).default(['ar', 'en', 'ml']),
    useAiReview: z.boolean().default(false),
    /** Full-AI posters (AI-drawn text): require a human approval before publishing. Admin may turn it off. */
    aiFullRequiresApproval: z.boolean().default(true),
    // USD estimates — editable because provider pricing changes. Verify against current OpenAI pricing.
    pricing: z.object({
      textInputPer1M: z.number().default(0.4),
      textOutputPer1M: z.number().default(1.6),
      imageLow: z.number().default(0.016),
      imageMedium: z.number().default(0.063),
      imageHigh: z.number().default(0.25),
    }).default({}),
  }).default({}),
  metricool: z.object({
    userId: z.string().default(''),
    baseUrl: z.string().default('https://app.metricool.com/api'),
    lastCheckAt: z.string().nullable().default(null),
    lastCheckOk: z.boolean().default(false),
    lastCheckMessage: z.string().nullable().default(null),
    requestsPerMinute: z.number().int().min(1).max(600).default(30),
  }).default({}),
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
export type SecretName = 'OPENAI_API_KEY' | 'METRICOOL_API_TOKEN';

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
