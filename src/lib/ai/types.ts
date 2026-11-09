import { z } from 'zod';

export const CreativeBriefSchema = z.object({
  idea: z.string().min(5).max(400),
  ideaKey: z.string().min(3).max(120),
  audience: z.string().min(2).max(200),
  occasion: z.string().min(2).max(120),
  sceneDescription: z.string().min(20).max(1500),
  headline: z.string().min(2).max(60),
  supportingCopy: z.string().max(110),
  cta: z.string().min(2).max(30),
  caption: z.string().min(10).max(1800),
  hashtags: z.array(z.string().max(40)).max(12),
  styleNotes: z.string().max(400),
});
export type CreativeBriefOut = z.infer<typeof CreativeBriefSchema>;

/** JSON schema for OpenAI structured outputs (strict mode — all fields required). */
export const CreativeBriefJsonSchema = {
  type: 'object', additionalProperties: false,
  required: ['idea', 'ideaKey', 'audience', 'occasion', 'sceneDescription', 'headline', 'supportingCopy', 'cta', 'caption', 'hashtags', 'styleNotes'],
  properties: {
    idea: { type: 'string', description: 'One-sentence advertising concept, in English' },
    ideaKey: { type: 'string', description: 'short kebab-case English key summarising the concept angle, e.g. "mug-morning-ritual-gift"' },
    audience: { type: 'string' },
    occasion: { type: 'string' },
    sceneDescription: { type: 'string', description: 'English photographic scene description for the image model. Must NOT request any text, letters, numbers, logos or watermarks.' },
    headline: { type: 'string', description: 'Headline in the target language, max 6 words' },
    supportingCopy: { type: 'string', description: 'Optional one-line supporting copy in the target language, max 12 words, may be empty' },
    cta: { type: 'string', description: 'Call to action in the target language' },
    caption: { type: 'string', description: 'Social caption in the target language. Must not include prices, discounts, delivery times or superlatives that cannot be verified.' },
    hashtags: { type: 'array', items: { type: 'string' } },
    styleNotes: { type: 'string' },
  },
} as const;

export interface BriefRequest {
  language: 'ar' | 'en' | 'ml';
  product: { slug: string; name: string; titleAr: string; titleEn: string; titleMl?: string | null; targetAudience: string[]; occasions: string[]; visualGuidelines: string; recommendedMessages: Record<string, string[]> };
  accountName: string; businessCategory?: string | null;
  creativeStyle: string; defaultCta: string;
  avoidIdeas: string[]; // recent ideas on this account (30 days)
  avoidHeadlines: string[];
  attempt: number;
}

export interface TextUsage { inputTokens: number; outputTokens: number }
export interface ImageResult { png: Buffer; model: string; revisedPrompt?: string }

export interface AiProvider {
  readonly name: string;
  readonly isDryRun: boolean;
  generateBrief(req: BriefRequest, model: string): Promise<{ brief: CreativeBriefOut; usage: TextUsage; model: string }>;
  generateScene(prompt: string, opts: { model: string; quality: 'low' | 'medium' | 'high'; size: '1024x1536' | '1024x1024' | '1536x1024'; seedHint: string }): Promise<ImageResult>;
}

export class AiProviderError extends Error {
  constructor(public code: 'AUTH' | 'BILLING' | 'RATE_LIMIT' | 'CONTENT_POLICY' | 'BAD_OUTPUT' | 'NETWORK' | 'UNKNOWN', message: string, public retryable: boolean) { super(message); }
}
