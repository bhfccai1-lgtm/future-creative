import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { getSettings, secretStatus, setSecret, updateSettings } from '@/lib/settings';
import { audit } from '@/lib/audit';
import { estimateAdCost, monthToDateSpend } from '@/lib/ai/cost';

const Body = z.object({
  apiKey: z.string().max(300).optional(), // write-only; empty string = keep, "__delete__" = remove
  dryRun: z.boolean(), textModel: z.string().min(2).max(80), imageModel: z.string().min(2).max(80),
  imageQuality: z.enum(['low', 'medium', 'high']), monthlyBudgetUsd: z.number().min(0).max(100000),
  alertThresholdPct: z.number().min(1).max(100), maxDailyAds: z.number().int().min(0).max(1000), maxRetries: z.number().int().min(0).max(5),
  creativeStyle: z.string().min(10).max(1000), languages: z.array(z.enum(['ar', 'en', 'ml'])).min(1), useAiReview: z.boolean().default(false), aiFullRequiresApproval: z.boolean().default(true),
  autoRenderMode: z.enum(['auto', 'layered', 'ai_full']).default('auto'), autoDesignStyle: z.string().max(40).default('fc_signature'),
  qualityByFormat: z.object(Object.fromEntries(['IMAGE_STORY', 'IMAGE_FEED', 'IMAGE_SQUARE', 'IMAGE_CAROUSEL', 'REEL_VIDEO'].map((f) => [f, z.enum(['', 'low', 'medium', 'high']).default('')])) as Record<'IMAGE_STORY' | 'IMAGE_FEED' | 'IMAGE_SQUARE' | 'IMAGE_CAROUSEL' | 'REEL_VIDEO', z.ZodDefault<z.ZodEnum<['', 'low', 'medium', 'high']>>>).optional(),
  pricing: z.object({ textInputPer1M: z.number().min(0), textOutputPer1M: z.number().min(0), imageLow: z.number().min(0), imageMedium: z.number().min(0), imageHigh: z.number().min(0) }),
});

export const GET = api('settings:ai', async () => {
  const s = await getSettings();
  return NextResponse.json({ ai: s.ai, key: await secretStatus('OPENAI_API_KEY'), estimatedCostPerAd: estimateAdCost(s), monthToDate: await monthToDateSpend() });
});

export const PUT = api('settings:ai', async (req, { user }) => {
  const { apiKey, ...ai } = Body.parse(await req.json());
  if (apiKey === '__delete__') await setSecret('OPENAI_API_KEY', null, user.email);
  else if (apiKey) await setSecret('OPENAI_API_KEY', apiKey.trim(), user.email);
  const s = await updateSettings((x) => ({ ...x, ai: { ...x.ai, ...ai } }), user.email);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'settings.ai.update', details: { keyChanged: !!apiKey, dryRun: ai.dryRun, textModel: ai.textModel, imageModel: ai.imageModel, budget: ai.monthlyBudgetUsd } });
  return NextResponse.json({ ai: s.ai, key: await secretStatus('OPENAI_API_KEY') });
});
