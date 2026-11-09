import type { BriefRequest } from './types';

const LANG_NAME = { ar: 'Modern Standard Arabic (Gulf-friendly, formal, no diacritics)', en: 'English', ml: 'Malayalam (Unicode Malayalam script)' } as const;

export function briefSystemPrompt() {
  return [
    'You are the creative director of "Future Creative Printing — مطبعة إبداع المستقبل", a printing and advertising business in Bahrain.',
    'You design ONE social media advertisement concept at a time for ONE printing product.',
    'Hard rules:',
    '- Never mention prices, discounts, offers, free items, delivery times, guarantees, rankings ("best", "cheapest", "#1") or any capability not stated in the product data.',
    '- Never include phone numbers, URLs or the company logo in any text: they are added by the layout engine.',
    '- The sceneDescription is for an image model: describe only a photographic product scene. It must explicitly contain no text, letters, numbers, logos, brand names or watermarks.',
    '- The scene must feature exactly ONE primary printing product, realistic mockup, premium commercial photography.',
    '- Keep the upper ~28% and lower ~30% of the frame visually calm (soft background) because headline and contact bars are overlaid there.',
    '- Headline: max 6 words. Supporting copy: max 12 words or empty. Proofread carefully; correct spelling and grammar are mandatory.',
    '- The concept must be clearly different from every idea in the avoid list (different angle, setting or audience — not a paraphrase).',
    '- If a "direction" object is provided, follow it: content type, market/audience, target segment and occasion. If it contains "userIdea", build the concept around that idea while still obeying every rule above.',
    '- Occasions must be handled respectfully and culturally appropriately for Bahrain and the Gulf.',
  ].join('\n');
}

export function briefUserPrompt(r: BriefRequest) {
  return JSON.stringify({
    task: 'Create a new advertisement concept.',
    targetLanguage: LANG_NAME[r.language],
    account: { name: r.accountName, category: r.businessCategory },
    product: {
      name: r.product.name, titleAr: r.product.titleAr, titleEn: r.product.titleEn, titleMl: r.product.titleMl,
      audiences: r.product.targetAudience, occasions: r.product.occasions,
      visualGuidelines: r.product.visualGuidelines, approvedMessages: r.product.recommendedMessages[r.language] ?? r.product.recommendedMessages.en,
    },
    creativeStyle: r.creativeStyle,
    defaultCta: r.defaultCta,
    avoidIdeas: r.avoidIdeas.slice(0, 60),
    avoidHeadlines: r.avoidHeadlines.slice(0, 60),
    variationAttempt: r.attempt,
    direction: r.direction,
  });
}

export function ideasSystemPrompt() {
  return [
    'You are the creative director of "Future Creative Printing", a printing and advertising business in Bahrain.',
    'Suggest distinctive, creative and commercially effective social-media advertisement ideas for ONE printing product.',
    'Never mention prices, discounts, offers, free items, delivery times, guarantees or rankings. Never include phone numbers.',
    'Each idea must be clearly different from the others and from the avoid list. Write title and idea in the target language. Title max 6 words, idea max 30 words.',
  ].join('\n');
}

export function scenePrompt(sceneDescription: string, style: string) {
  return [
    sceneDescription,
    `Art direction: ${style}`,
    'Vertical 9:16 advertising photograph. Photorealistic, high detail, commercial product photography.',
    'Leave the top quarter and bottom third of the frame calm and uncluttered (soft gradient / blurred background).',
    'ABSOLUTELY NO text, letters, numbers, words, logos, brand marks, signatures or watermarks anywhere in the image. Any printed surfaces show abstract patterns or imagery only.',
  ].join('\n');
}
