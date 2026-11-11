import type { BriefRequest } from './types';

const LANG_NAME = { ar: 'natural Bahraini / Gulf Arabic as spoken by customers in Bahrain (warm, conversational, correct spelling, no diacritics; MSA only for formal B2B wording)', en: 'English', ml: 'Malayalam (Unicode Malayalam script)' } as const;

export function briefSystemPrompt() {
  return [
    'You are the creative director of "Future Creative Printing — مطبعة إبداع المستقبل", a printing and advertising business in Bahrain.',
    'You design ONE social media advertisement concept at a time for ONE printing product.',
    'Hard rules:',
    '- Never mention prices, discounts, offers, free items, delivery times, guarantees, rankings ("best", "cheapest", "#1") or any capability not stated in the product data.',
    '- Never include phone numbers, URLs or the company logo in any text: they are added by the layout engine.',
    '- The design is a premium Gulf-style advertising poster: a short kicker (headline, 2-4 words), the product keyword in a big gold badge (badge, 1-2 words), and one short line below (supportingCopy, 2-6 words). Example: headline "طباعة جميع أنواع", badge "الأكواب", supportingCopy "بتصاميمك الخاصة".',
    '- The sceneDescription is a photo brief for an image model. ONE hero printing product, LARGE (about half the frame height), sharp, fully visible and centred, showing a beautiful printed ILLUSTRATION on its surface that fits the occasion and audience (artwork, motifs, characters or patterns — never letters). Add 2-4 tasteful props that tell the story (e.g. graduation cap, flowers, gift ribbon), warm bright commercial studio lighting, rich colours, shallow depth of field with golden bokeh. Specify materials, camera angle and lens.',
    '- The sceneDescription must explicitly say: no text, letters, numbers, logos, brand names or watermarks anywhere.',
    '- Proofread carefully; correct spelling and grammar are mandatory.',
    '- The concept must be clearly different from every idea in the avoid list (different angle, setting or audience — not a paraphrase).',
    '- If a "direction" object is provided, follow it: content type, market/audience, target segment and occasion. If it contains "userIdea", build the concept around that idea while still obeying every rule above.',
    '- Occasions must be handled respectfully and culturally appropriately for Bahrain and the Gulf.',
    '',
    'CAPTION — write it for fast organic reach on Instagram/TikTok/Facebook, matched to the design:',
    '- Line 1 is a scroll-stopping HOOK (max ~8 words, under 125 characters so it shows before "more"): a relatable moment, a question or a bold benefit. It must echo the headline/visual of the design.',
    '- Then 2–4 short lines (one idea per line): the benefit for the target audience, a concrete use-case or emotion, and why a custom print makes it special.',
    '- Optimise for SENDS and DMs (they drive reach to non-followers): one line inviting the reader to send the post to the person it would suit (e.g. "أرسله لصديقك اللي يستاهل هالهدية"), and a DM keyword CTA (e.g. "أرسل كلمة «كوب» على الخاص ونرد عليك بالتفاصيل"). Never fake giveaways or contests; never promise prices.',
    '- Keep the whole caption short: 3–6 lines before the CTA. Long captions were measured to get zero comments on these accounts.',
    '- End with a clear call to action using the CTA wording; do NOT write phone numbers (the system appends the verified contact line).',
    '- Use 2–4 fitting emojis maximum, natural for the language; keep sentences short; no ALL CAPS; correct spelling and grammar.',
    '- Write natively in the target language (natural Bahraini/Gulf Arabic for ar). Never mix scripts except brand/hashtags.',
    '- hashtags: 3–5 total (Instagram caps posts at 5): 1 local tag (#البحرين or #Bahrain), 2–3 specific product/occasion tags in the target language, optionally 1 English niche tag. No generic or spammy tags.',
    '- headline (on the design) and the hook must work together but not be identical.',
  ].join('\n');
}

export function briefUserPrompt(r: BriefRequest) {
  return JSON.stringify({
    task: 'Create a new advertisement concept.',
    format: r.format ?? 'IMAGE_STORY',
    formatNote: r.format === 'IMAGE_CAROUSEL' ? 'Carousel post: the cover uses headline/badge/supportingCopy; fill `slides` with 3-4 genuinely useful slides (saves and shares come from useful carousels). End the caption by inviting people to save the post.' : 'Return slides as [].',
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
    'Vertical 9:16 premium advertising product photograph, photorealistic, ultra sharp focus on the product, high dynamic range, rich true-to-life colours, professional retouching.',
    'Composition: the hero product is LARGE, fully visible and centred in the middle of the frame (roughly between 30% and 72% of the height); the upper 28% is a softly blurred continuation of the background (bokeh, warm lights) and the lower 25% is the table/surface in soft focus.',
    'The printed surface of the product shows a vivid, high-quality printed illustration or pattern that suits the occasion — artwork only.',
    'ABSOLUTELY NO text, letters, numbers, words, logos, brand marks, signatures or watermarks anywhere in the image, including on the product.',
  ].join('\n');
}

const SCRIPT_NAME = { ar: 'Arabic', en: 'English', ml: 'Malayalam' } as const;

/**
 * "Full AI design" (ChatGPT-like): the image model designs the complete poster — typography, gold badge,
 * benefit icons, decorations and the hero product. Two zones are reserved for deterministic layers:
 * the ORIGINAL logo (top) and the CTA + verified phone numbers (bottom band, added below the image).
 */
export function fullPosterPrompt(p: {
  lang: 'ar' | 'en' | 'ml'; headline: string; badge: string; support?: string | null; features: string[];
  sceneDescription: string; style: string; customPrompt?: string | null;
}) {
  const S = SCRIPT_NAME[p.lang];
  return [
    'Design a complete, finished, world-class vertical advertising poster for a premium print shop in Bahrain (portrait 2:3). Luxury Gulf commercial style, professional graphic design, social-media ready.',
    p.customPrompt?.trim() ? `Client brief (follow it closely): ${p.customPrompt.trim()}` : `Art direction: ${p.style}`,
    `Hero product photo: ${p.sceneDescription}`,
    `Typography — render EXACTLY these words, perfectly spelled ${S} text${p.lang === 'ar' ? ' (correct right-to-left Arabic letter joining, bold modern Arabic display font)' : ''}, nothing else:`,
    `  • kicker line near the top: "${p.headline}"`,
    p.badge ? `  • big hero keyword inside a glossy 3D gold pill badge with small sparkle rays: "${p.badge}"` : '',
    p.support ? `  • tagline under the badge: "${p.support}"` : '',
    p.features.length ? `  • a row of ${p.features.length} elegant gold line icons in circles with these labels under them: ${p.features.map((f) => `"${f}"`).join(', ')}` : '',
    'Decoration: elegant flowing gold ribbon swooshes, soft golden bokeh, rich deep royal navy background, high-end retouching.',
    'MANDATORY reserved areas:',
    '  • The TOP 14% of the poster must stay empty: only softly blurred background — no text, no logo, no shapes (the official logo is placed there later).',
    '  • Do NOT draw any order button, phone numbers, branch names, logo, brand name, website, QR code, prices, discounts or delivery promises anywhere (they are added separately below the poster).',
  ].filter(Boolean).join('\n');
}
