import { z } from 'zod';
import { CONTENT_TYPES, DESIGN_STYLES, DESIGN_TYPES, MARKETS, OCCASIONS, SEGMENTS, optionValues } from './creative/options';

export const AccountInput = z.object({
  name: z.string().min(2).max(100),
  platform: z.enum(['instagram', 'facebook', 'tiktok', 'threads', 'youtube', 'pinterest', 'linkedin', 'twitter']),
  handle: z.string().max(100).optional().nullable(),
  language: z.enum(['ar', 'en', 'ml']),
  businessCategory: z.string().max(100).optional().nullable(),
  allowedProductIds: z.array(z.string()).max(200).default([]),
  publishFormat: z.enum(['IMAGE_STORY', 'IMAGE_FEED', 'IMAGE_SQUARE', 'REEL_VIDEO']),
  publishIntervalMinutes: z.number().int().min(60).max(7 * 24 * 60),
  publishWindowStart: z.string().regex(/^\d{2}:\d{2}$/),
  publishWindowEnd: z.string().regex(/^\d{2}:\d{2}$/),
  timezone: z.string().default('Asia/Bahrain'),
  reelDurationSec: z.number().int().min(6).max(60).default(12),
  maxDailyAds: z.number().int().min(1).max(48).default(4),
});

export const ProductInput = z.object({
  slug: z.string().regex(/^[a-z0-9-]{3,60}$/), categoryId: z.string(), name: z.string().min(2).max(100),
  titleAr: z.string().min(2).max(100), titleEn: z.string().min(2).max(100), titleMl: z.string().max(100).optional().nullable(),
  targetAudience: z.array(z.string().max(60)).max(20), occasions: z.array(z.string().max(60)).max(20),
  visualGuidelines: z.string().min(10).max(1000),
  recommendedMessages: z.object({ ar: z.array(z.string().max(120)).max(10), en: z.array(z.string().max(120)).max(10), ml: z.array(z.string().max(120)).max(10).optional() }),
  relevantAccountTags: z.array(z.string().max(40)).max(20).default([]),
  active: z.boolean().default(true),
});

export const DirectionSchema = z.object({
  contentType: z.enum(optionValues(CONTENT_TYPES)).optional(),
  market: z.enum(optionValues(MARKETS)).optional(),
  segment: z.enum(optionValues(SEGMENTS)).optional(),
  occasion: z.enum(optionValues(OCCASIONS)).optional(),
  idea: z.string().max(500).optional(),
  designType: z.enum(optionValues(DESIGN_TYPES)).optional(),
  designStyle: z.enum(optionValues(DESIGN_STYLES)).optional(),
  layout: z.enum(['gold-poster', 'navy-gold-classic', 'gold-frame-lower']).optional(),
  renderMode: z.enum(['layered', 'ai_full']).optional(),
  customPrompt: z.string().max(3000).optional(),
  channels: z.array(z.enum(['instagram', 'facebook', 'tiktok', 'threads', 'youtube', 'linkedin', 'twitter'])).max(7).optional(),
  reelStyle: z.enum(['standard', 'pro']).optional(),
  reelDuration: z.number().int().min(6).max(60).optional(),
  audio: z.enum(['none', 'ambient', 'upbeat', 'instagram']).optional(),
  audioQuery: z.string().max(120).optional(),
}).optional();

export const CampaignInput = z.object({
  name: z.string().min(2).max(100),
  accountIds: z.array(z.string()).min(1, 'اختر حسابًا واحدًا على الأقل').max(50),
  productId: z.string().optional().nullable(),
  format: z.enum(['IMAGE_STORY', 'IMAGE_FEED', 'IMAGE_SQUARE', 'REEL_VIDEO']).optional().nullable(),
  language: z.enum(['ar', 'en', 'ml']).optional().nullable(),
  direction: DirectionSchema,
  scheduleType: z.enum(['ONCE', 'RECURRING']),
  everyHours: z.number().int().min(1).max(24 * 14).default(24),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  timeMode: z.enum(['BEST', 'FIXED']).default('BEST'),
  startAt: z.coerce.date(),
  endAt: z.coerce.date().optional().nullable(),
  maxRuns: z.number().int().min(1).max(10000).optional().nullable(),
});
