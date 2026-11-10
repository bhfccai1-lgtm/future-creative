import { z } from 'zod';

export const CreativeBriefSchema = z.object({
  idea: z.string().min(5).max(400),
  ideaKey: z.string().min(3).max(120),
  audience: z.string().min(2).max(200),
  occasion: z.string().min(2).max(120),
  sceneDescription: z.string().min(20).max(1500),
  headline: z.string().min(2).max(60),
  badge: z.string().max(24).default(''),
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
  required: ['idea', 'ideaKey', 'audience', 'occasion', 'sceneDescription', 'headline', 'badge', 'supportingCopy', 'cta', 'caption', 'hashtags', 'styleNotes'],
  properties: {
    idea: { type: 'string', description: 'One-sentence advertising concept, in English' },
    ideaKey: { type: 'string', description: 'short kebab-case English key summarising the concept angle, e.g. "mug-morning-ritual-gift"' },
    audience: { type: 'string' },
    occasion: { type: 'string' },
    sceneDescription: { type: 'string', description: 'English photo brief for the image model: ONE hero product, large and sharp in the centre, with a tasteful printed ILLUSTRATION on it that fits the occasion (no letters), 2-4 styled props, warm bright commercial lighting, bokeh background. Must NOT request text, letters, numbers, logos or watermarks.' },
    headline: { type: 'string', description: 'Short kicker line above the badge in the target language, 2-4 words (e.g. "طباعة جميع أنواع", "Custom printed")' },
    badge: { type: 'string', description: 'The hero keyword shown big inside a gold badge: the product name in 1-2 words in the target language (e.g. "الأكواب", "الملصقات", "Mugs")' },
    supportingCopy: { type: 'string', description: 'One short line under the badge in the target language, 2-6 words (e.g. "بتصاميمك الخاصة")' },
    cta: { type: 'string', description: 'Call to action in the target language' },
    caption: { type: 'string', description: 'High-reach social caption in the target language: hook line, 2-4 short benefit lines, engagement prompt, CTA. No prices, discounts, delivery times, unverifiable superlatives or phone numbers. Hashtags go in the hashtags field, not here.' },
    hashtags: { type: 'array', items: { type: 'string' }, description: '8-12 hashtags, each starting with #: local reach + niche product + occasion + 1-2 English' },
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
  /** Optional creative direction chosen by the user (English instructions). */
  direction?: Record<string, string>;
  /** Selected occasion key, if any (lets providers pick occasion-appropriate wording). */
  occasionKey?: string;
}

export interface IdeaSuggestion { title: string; idea: string }
export const IdeaSuggestionsJsonSchema = {
  type: 'object', additionalProperties: false, required: ['ideas'],
  properties: { ideas: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'idea'], properties: { title: { type: 'string' }, idea: { type: 'string' } } } } },
} as const;

export interface TextUsage { inputTokens: number; outputTokens: number }
export interface ImageResult { png: Buffer; model: string; revisedPrompt?: string }

export interface AiProvider {
  readonly name: string;
  readonly isDryRun: boolean;
  generateBrief(req: BriefRequest, model: string): Promise<{ brief: CreativeBriefOut; usage: TextUsage; model: string }>;
  /** Optional vision transcription of text drawn in an image (used to review full-AI posters). */
  readText?(png: Buffer, model: string): Promise<{ text: string; usage: TextUsage; model: string }>;
  suggestIdeas(req: BriefRequest, model: string, count: number): Promise<{ ideas: IdeaSuggestion[]; usage: TextUsage; model: string }>;
  generateScene(prompt: string, opts: { model: string; quality: 'low' | 'medium' | 'high'; size: '1024x1536' | '1024x1024' | '1536x1024'; seedHint: string }): Promise<ImageResult>;
}

export class AiProviderError extends Error {
  constructor(public code: 'AUTH' | 'BILLING' | 'RATE_LIMIT' | 'CONTENT_POLICY' | 'BAD_OUTPUT' | 'NETWORK' | 'UNKNOWN', message: string, public retryable: boolean) { super(message); }
}
