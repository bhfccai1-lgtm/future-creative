/**
 * AUTOMATIC AD STYLE BY PRODUCT (the owner's table, V10 spec §4): the tone and visual language of the ad follow what
 * is being sold — a mug ad is playful and 3D, a wedding card is luxurious gold, a business card minimalist. Matched on
 * the product slug, its names and its category; the creative director (brief) and the image model both receive it.
 */
export interface AdStyle { key: string; ar: string; tone: string; visual: string }

const S = (key: string, ar: string, tone: string, visual: string): AdStyle => ({ key, ar, tone, visual });
const STYLES: { match: RegExp; style: AdStyle }[] = [
  { match: /mug|cup|drinkware|كوب|أكواب|مج/i, style: S('mugs', 'فكاهي، إبداعي، ثلاثي الأبعاد', 'humorous and creative: a witty, relatable mini-story around the mug (light everyday humour, never silly)', 'playful 3D-style product hero, bold colours, a surprising scale or character moment, glossy ceramic realism') },
  { match: /sticker|label|vinyl|ملصق|ستيكر|استيكر|ليبل/i, style: S('stickers', 'حيوي، ملون، عرض واقعي', 'vivid and energetic: shows the stickers in real use where people would put them', 'colourful, punchy palette, realistic display on a laptop / bottle / box, crisp die-cut edges') },
  { match: /wedding|invitation|زفاف|عرس|أعراس|دعوة|دعوات/i, style: S('wedding', 'فاخر، ذهبي، أنيق', 'luxurious and elegant: romance, celebration, refined Gulf taste', 'gold foil, ivory and champagne tones, soft romantic light, flowers and satin, generous negative space') },
  { match: /t-?shirt|apparel|cap|hoodie|تيشيرت|تيشرت|ملابس|قبعة/i, style: S('apparel', 'عصري، شبابي، تصوير أزياء', 'modern and youthful: streetwear energy, confidence, belonging', 'fashion photography: a model wearing it in an urban Bahrain setting, dynamic pose, trendy colour grade') },
  { match: /education|school|certificate|poster.*educ|تعليم|مدرس|مدارس|شهادات|تعليمية/i, style: S('education', 'مرح، واضح، تربوي', 'cheerful, clear and educational: friendly for children, parents and teachers', 'bright clean colours, classroom or study setting, simple shapes, very clear hierarchy') },
  { match: /gift|personali[sz]ed|هدية|هدايا/i, style: S('gifts', 'عاطفي، سينمائي', 'emotional and cinematic: the feeling of giving and receiving, a heartfelt moment', 'cinematic warm light, shallow depth of field, a gift reveal moment, rich storytelling') },
  { match: /business.?card|بطاق(ة|ات) (عمل|الأعمال)|كروت/i, style: S('business-cards', 'احترافي، بسيط (Minimalist)', 'professional and minimal: credibility, precision, first impressions', 'minimalist composition, premium paper texture, restrained palette, lots of negative space, sharp detail') },
  { match: /canvas|كانفس|لوح(ة|ات) (فن|فنية)/i, style: S('canvas', 'فني، عاطفي، واقعي', 'artistic and emotional: a memory turned into art for the home', 'gallery-like interior, realistic canvas texture and wrapped frame, warm emotional light') },
  { match: /stamp|أختام|ختم/i, style: S('stamps', 'تجاري، تصوير منتجات', 'commercial and practical: reliability for offices and businesses', 'clean product photography, the stamp beside a crisp ink impression, office setting') },
  { match: /photo.?prop|props|مسكات|مسكة|إكسسوارات تصوير/i, style: S('photo-props', 'فاخر، احتفالي', 'luxurious and celebratory: party moments, smiles, photos to remember', 'festive party setting, confetti and warm bokeh, people holding the props, gold accents') },
];
const BY_CATEGORY: Record<string, string> = { drinkware: 'mugs', 'stickers-labels': 'stickers', 'events-weddings': 'wedding', apparel: 'apparel', education: 'education', gifts: 'gifts', corporate: 'business-cards', 'signage-decor': 'canvas' };

/** The ad style for a product: its own words first (slug, names), then its category; null = the general direction. */
export function adStyleFor(p: { slug?: string | null; name?: string | null; titleAr?: string | null; titleEn?: string | null; categorySlug?: string | null }): AdStyle | null {
  const words = [p.slug, p.name, p.titleAr, p.titleEn].filter(Boolean).join(' ');
  const hit = STYLES.find((x) => x.match.test(words));
  if (hit) return hit.style;
  const k = p.categorySlug ? BY_CATEGORY[p.categorySlug] : undefined;
  return k ? STYLES.find((x) => x.style.key === k)!.style : null;
}

export const adStylePrompt = (a: AdStyle) => `Ad style for this product (owner's rule): tone — ${a.tone}; visual language — ${a.visual}.`;
