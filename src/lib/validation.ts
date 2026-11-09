import { z } from 'zod';
import { CONTENT_TYPES, MARKETS, OCCASIONS, SEGMENTS, optionValues } from './creative/options';

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
  maxDailyAds: z.number().int().min(1).max(48).default(24),
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
}).optional();
