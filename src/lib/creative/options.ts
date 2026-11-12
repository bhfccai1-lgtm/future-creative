/**
 * Creative direction options for "إنشاء تصميم جديد".
 * Pure data (safe for client + server). `prompt` is the English instruction given to the AI.
 * No option implies prices, discounts, delivery times or other unverifiable claims.
 */
export interface Opt { value: string; ar: string; en: string; prompt: string }

export const CONTENT_TYPES: Opt[] = [
  { value: 'product_showcase', ar: 'عرض المنتج بشكل فاخر', en: 'Premium product showcase', prompt: 'premium hero showcase of the printed product itself' },
  { value: 'real_use', ar: 'المنتج في الاستخدام الواقعي', en: 'Real-life use', prompt: 'the product being used naturally in a realistic everyday setting' },
  { value: 'gift_idea', ar: 'فكرة هدية', en: 'Gift idea', prompt: 'the product presented as a thoughtful personalised gift' },
  { value: 'business_branding', ar: 'هوية الشركات والعلامة التجارية', en: 'Business branding', prompt: 'how the product makes a business or brand look professional and consistent' },
  { value: 'occasion_greeting', ar: 'تهنئة بمناسبة', en: 'Occasion greeting', prompt: 'a warm greeting for the selected occasion featuring the product, no sales pressure' },
  { value: 'educational_tip', ar: 'نصيحة أو معلومة عن الطباعة', en: 'Printing tip', prompt: 'a short useful tip about choosing or using this kind of printed product' },
  { value: 'quality_craft', ar: 'الجودة والحرفية والتفاصيل', en: 'Quality & craftsmanship', prompt: 'close-up craftsmanship and print-quality details of the product' },
  { value: 'behind_scenes', ar: 'من داخل المطبعة', en: 'Behind the scenes', prompt: 'behind-the-scenes in a modern clean print workshop with the finished product in focus' },
];

export const MARKETS: Opt[] = [
  { value: 'bahrain_local', ar: 'السوق البحريني (مواطنون ومقيمون)', en: 'Bahrain — local market', prompt: 'the local Bahraini market (citizens and residents), Gulf Arabic cultural context' },
  { value: 'bahrain_business', ar: 'الشركات والمؤسسات في البحرين', en: 'Bahrain — businesses (B2B)', prompt: 'companies and institutions in Bahrain (B2B), professional corporate tone' },
  { value: 'gcc_saudi', ar: 'السعودية ودول الخليج', en: 'Saudi Arabia & GCC', prompt: 'customers in Saudi Arabia and the wider GCC, Gulf cultural context' },
  { value: 'indian_community', ar: 'الجالية الهندية في البحرين', en: 'Indian community in Bahrain', prompt: 'the Indian (including Malayali) community living in Bahrain' },
  { value: 'english_expats', ar: 'المقيمون الناطقون بالإنجليزية', en: 'English-speaking expats', prompt: 'English-speaking expatriates living in Bahrain' },
];

export const SEGMENTS: Opt[] = [
  { value: 'companies', ar: 'الشركات', en: 'Companies', prompt: 'companies and corporate teams' },
  { value: 'small_business', ar: 'المشاريع الصغيرة والمنزلية', en: 'Small & home businesses', prompt: 'small businesses and home-based businesses' },
  { value: 'restaurants_cafes', ar: 'المطاعم والمقاهي', en: 'Restaurants & cafés', prompt: 'restaurants, cafés and food brands' },
  { value: 'retail_shops', ar: 'المحلات التجارية', en: 'Retail shops', prompt: 'retail shops and showrooms' },
  { value: 'schools', ar: 'المدارس والجامعات', en: 'Schools & universities', prompt: 'schools, universities and training centres' },
  { value: 'students', ar: 'الطلاب', en: 'Students', prompt: 'students and young people' },
  { value: 'families', ar: 'العائلات', en: 'Families', prompt: 'families' },
  { value: 'couples_weddings', ar: 'المقبلون على الزواج', en: 'Couples & weddings', prompt: 'engaged couples and wedding families' },
  { value: 'event_organizers', ar: 'منظمو الفعاليات والمعارض', en: 'Event organisers', prompt: 'event, conference and exhibition organisers' },
  { value: 'gift_buyers', ar: 'محبو الهدايا', en: 'Gift buyers', prompt: 'people looking for meaningful gifts' },
];

export const OCCASIONS: (Opt & { headlineAr?: string; headlineEn?: string })[] = [
  { value: 'everyday', ar: 'بدون مناسبة (يومي)', en: 'Everyday', prompt: 'everyday, no specific occasion' },
  { value: 'bahrain_national_day', ar: 'العيد الوطني البحريني (16 ديسمبر)', en: 'Bahrain National Day', prompt: 'Bahrain National Day (16 December) — tasteful red and white accents, pride in Bahrain', headlineAr: 'نحتفل بالعيد الوطني', headlineEn: 'Celebrating Bahrain National Day' },
  { value: 'saudi_national_day', ar: 'اليوم الوطني السعودي (23 سبتمبر)', en: 'Saudi National Day', prompt: 'Saudi National Day (23 September) — tasteful green accents', headlineAr: 'فخر بالوطن', headlineEn: 'Celebrating Saudi National Day' },
  { value: 'ramadan', ar: 'شهر رمضان', en: 'Ramadan', prompt: 'the holy month of Ramadan — calm, elegant, lanterns and crescent motifs, respectful tone', headlineAr: 'أجواء رمضان بلمسة إبداع', headlineEn: 'Ramadan, Beautifully Printed' },
  { value: 'eid_fitr', ar: 'عيد الفطر', en: 'Eid al-Fitr', prompt: 'Eid al-Fitr celebration — joyful family gifting atmosphere', headlineAr: 'عيدكم مبارك', headlineEn: 'Eid Mubarak' },
  { value: 'eid_adha', ar: 'عيد الأضحى', en: 'Eid al-Adha', prompt: 'Eid al-Adha celebration — warm family gathering atmosphere', headlineAr: 'عيد أضحى مبارك', headlineEn: 'Eid al-Adha Mubarak' },
  { value: 'back_to_school', ar: 'العودة إلى المدارس', en: 'Back to school', prompt: 'back-to-school season', headlineAr: 'عودة مدرسية مميزة', headlineEn: 'Back to School in Style' },
  { value: 'graduation', ar: 'التخرج', en: 'Graduation', prompt: 'graduation celebrations', headlineAr: 'لحظة تخرج لا تُنسى', headlineEn: 'A Graduation to Remember' },
  { value: 'wedding_season', ar: 'موسم الأعراس', en: 'Wedding season', prompt: 'wedding season — elegant, luxurious, floral', headlineAr: 'تفاصيل تليق بفرحتكم', headlineEn: 'Details Worthy of Your Day' },
  { value: 'mothers_day', ar: 'عيد الأم (21 مارس)', en: "Mother's Day", prompt: "Mother's Day (21 March in the Arab world) — tender, heartfelt gifting", headlineAr: 'هدية تليق بأمي', headlineEn: 'A Gift Worthy of Mum' },
  { value: 'new_year', ar: 'العام الجديد', en: 'New Year', prompt: 'the new year — fresh start, planning ahead', headlineAr: 'بداية جديدة بإبداع', headlineEn: 'A Fresh Start in Print' },
  { value: 'exhibitions_events', ar: 'موسم المعارض والفعاليات', en: 'Exhibitions & events', prompt: 'exhibition and conference season', headlineAr: 'جاهزون لمعرضكم القادم', headlineEn: 'Ready for Your Next Event' },
  { value: 'business_launch', ar: 'افتتاح أو إطلاق مشروع', en: 'Business launch', prompt: 'opening a new shop or launching a new business', headlineAr: 'انطلاقة تليق بمشروعك', headlineEn: 'Launch Your Business Right' },
  { value: 'gergaoon', ar: 'القرقاعون (منتصف رمضان)', en: 'Gergaoon', prompt: 'Gergaoon — the Bahraini mid-Ramadan children\'s celebration: children in traditional dress, colourful bags of sweets and nuts, joyful neighbourhood atmosphere', headlineAr: 'قرقاعون عادت عليكم', headlineEn: 'Happy Gergaoon' },
  { value: 'bahraini_women_day', ar: 'يوم المرأة البحرينية (1 ديسمبر)', en: 'Bahraini Women\'s Day', prompt: 'Bahraini Women\'s Day (1 December) — appreciation and pride, elegant and respectful', headlineAr: 'تحية للمرأة البحرينية', headlineEn: 'Celebrating Bahraini Women' },
  { value: 'teachers_day', ar: 'يوم المعلم (5 أكتوبر)', en: "Teachers' Day", prompt: "World Teachers' Day (5 October) — gratitude gifts for teachers from students and parents", headlineAr: 'شكرًا معلمي', headlineEn: 'Thank You, Teacher' },
  { value: 'onam', ar: 'مهرجان أونام', en: 'Onam', prompt: 'Onam festival celebrated by the Malayali community — floral pookalam motifs', headlineEn: 'Happy Onam' },
  { value: 'diwali', ar: 'مهرجان ديوالي', en: 'Diwali', prompt: 'Diwali festival of lights — diyas and warm glowing light', headlineEn: 'Happy Diwali' },
];

/** Scene composition — drives the AI image prompt. */
export const DESIGN_TYPES: Opt[] = [
  { value: 'hero_product', ar: 'لقطة منتج فاخرة (Hero)', en: 'Premium hero shot', prompt: 'premium studio hero shot of the product, centred, dramatic lighting, clean background' },
  { value: 'lifestyle', ar: 'أسلوب حياة (المنتج مع أشخاص)', en: 'Lifestyle', prompt: 'lifestyle photo with people naturally using the product, hands and context visible, faces not the focus' },
  { value: 'flat_lay', ar: 'تصوير علوي مرتب (Flat lay)', en: 'Flat lay', prompt: 'top-down flat lay arrangement with complementary props, neat composition' },
  { value: 'in_context', ar: 'المنتج في بيئته الحقيقية', en: 'In context', prompt: 'the product in its real environment (shop, office, event venue or home) as a realistic mockup' },
  { value: 'minimal_space', ar: 'تصميم بسيط بمساحة واسعة للنص', en: 'Minimal with space', prompt: 'minimal composition, product small-to-medium and off-centre, large calm negative space' },
  { value: 'macro_detail', ar: 'لقطة قريبة للتفاصيل والجودة', en: 'Macro detail', prompt: 'macro close-up showing print texture, edges, finish and material quality' },
];

/** Visual style — drives the image prompt AND the layout colour theme. */
export const DESIGN_STYLES: (Opt & { theme: 'navy_gold' | 'black_gold' | 'white_minimal' | 'emerald_gold' | 'festive_red' })[] = [
  { value: 'fc_signature', ar: 'توقيع المطبعة الإعلاني (من نماذجك)', en: 'Future Creative signature', theme: 'navy_gold', prompt: 'warm glossy 3D commercial advertising look: the hero product on a warm wooden table, softly blurred real setting (bright classroom, print workshop with a heat press, cosy café), a green plant, books, coloured pencils, a gift box or a colour-swatch fan as props, golden bokeh and soft sparkles, rich saturated cheerful colours; when people are involved, artwork printed on the product is in a cute Pixar-style 3D cartoon look, and for education a smiling child gives a thumbs up next to the product' },
  { value: 'luxury_navy_gold', ar: 'فاخر كحلي وذهبي (هوية المطبعة)', en: 'Luxury navy & gold', theme: 'navy_gold', prompt: 'premium commercial photography, cinematic lighting, deep navy and elegant gold accents' },
  { value: 'black_gold', ar: 'أسود فاخر مع ذهبي', en: 'Black & gold luxury', theme: 'black_gold', prompt: 'dark moody luxury photography, black surfaces, warm gold rim light, high contrast' },
  { value: 'white_minimal', ar: 'أبيض بسيط وعصري', en: 'Clean white minimal', theme: 'white_minimal', prompt: 'bright airy minimal photography, white and soft grey tones, soft daylight, modern Scandinavian feel' },
  { value: 'emerald_gold', ar: 'زمردي وذهبي راقٍ', en: 'Emerald & gold', theme: 'emerald_gold', prompt: 'elegant photography with deep emerald green and gold accents, rich textures' },
  { value: 'festive', ar: 'احتفالي ومبهج', en: 'Festive', theme: 'festive_red', prompt: 'festive celebratory photography, warm glowing lights, joyful mood, tasteful red accents' },
  { value: 'vibrant', ar: 'ألوان زاهية وحيوية', en: 'Vibrant colourful', theme: 'navy_gold', prompt: 'vibrant colourful energetic photography, saturated complementary colours, playful props' },
];

/**
 * Art-direction engine: every design gets a professional photo/poster recipe (composition × lighting × lens × poster layout),
 * rotated per account (least-recently-used) so consecutive designs never look alike. Recorded on the ad for reports.
 */
export interface Art { composition?: string; lighting?: string; lens?: string; poster?: string }
export const LIGHTING = [
  { value: 'softbox', light: true, prompt: 'large softbox studio lighting, gentle wrap-around shadows, clean highlights' },
  { value: 'golden_hour', light: true, prompt: 'warm golden-hour window light with long soft shadows' },
  { value: 'daylight', light: true, prompt: 'bright natural daylight, airy and fresh, soft bounce fill' },
  { value: 'rim', light: false, prompt: 'low-key dramatic lighting with a crisp rim light outlining the product' },
  { value: 'spotlight', light: false, prompt: 'single theatrical spotlight on the product with elegant dark falloff' },
  { value: 'ambient_evening', light: false, prompt: 'evening ambience, soft warm practical lights glowing in the blurred background' },
] as const;
export const LENSES = [
  { value: '85mm', prompt: '85mm lens at f/2.8, eye level, creamy background blur' },
  { value: 'low_hero', prompt: 'low three-quarter hero angle, 70mm lens, the product feels premium and monumental' },
  { value: '50mm', prompt: '50mm lens, natural perspective, slightly above eye level' },
  { value: '35mm_context', prompt: '35mm lens, slightly wider, real environment visible around the product' },
  { value: 'overhead', prompt: 'overhead 90-degree top-down camera, perfectly aligned' },
] as const;
export const POSTER_LAYOUTS = [
  { value: 'center_badge', prompt: 'symmetrical luxury layout: kicker line on top, glossy gold badge, the hero product centred below' },
  { value: 'split', prompt: 'asymmetric split layout: the product large on one side, the typography stacked on the other side with generous margins' },
  { value: 'type_top', prompt: 'bold oversized kicker typography in the upper third, the product large in the lower half on an elegant pedestal' },
  { value: 'framed_card', prompt: 'refined thin gold frame card layout, the product inside the frame and the typography above it' },
  { value: 'diagonal', prompt: 'dynamic diagonal composition, a flowing ribbon leads the eye from the headline to the product' },
  { value: 'editorial', prompt: 'minimal magazine-editorial layout with lots of negative space, refined typography and the gold badge' },
] as const;
/** Poster decoration that matches the colour theme (instead of always navy). */
export const THEME_DECOR: Record<string, string> = {
  navy_gold: 'elegant flowing gold ribbon swooshes, soft golden bokeh, rich deep royal navy background',
  black_gold: 'black marble and brushed gold foil accents, warm gold rim highlights, deep black background',
  white_minimal: 'clean white and soft warm-grey background, subtle natural shadows, thin gold accents',
  emerald_gold: 'deep emerald velvet textures with fine gold filigree accents',
  festive_red: 'festive deep red and gold ornaments, soft sparkles and warm glowing lights',
};
/** The owner's signature poster language (extracted from their own designs — style only, nothing copied). */
export function signaturePoster(o: { bahrain: boolean }) {
  return [
    'Signature poster language:',
    '  • a huge bold headline in glossy 3D metallic gold with a bevel and soft glow; a gold ribbon banner directly under it carries the tagline;',
    '  • the benefits as a row of deep-navy circular badges with thin gold rings and gold line icons, labels under each;',
    '  • flowing gold ribbon swooshes sweeping in from the corners, golden bokeh and tiny sparkles;',
    o.bahrain ? '  • at the very bottom a glowing Bahrain skyline silhouette (Bahrain World Trade Center towers) with golden city lights, and a Bahrain flag ribbon waving in one lower corner.' : '  • at the very bottom a softly glowing city skyline silhouette with golden lights.',
  ].join('\n');
}

/** Background colour story by occasion, then by audience (used unless the user picked a specific style). */
export const PALETTES: Record<string, { decor: string; theme: 'navy_gold' | 'black_gold' | 'white_minimal' | 'emerald_gold' | 'festive_red' }> = {
  bahrain_national_day: { theme: 'festive_red', decor: 'deep Bahraini red and white with gold accents and a waving Bahrain flag ribbon' },
  saudi_national_day: { theme: 'emerald_gold', decor: 'deep Saudi green and white with gold accents' },
  bahraini_women_day: { theme: 'festive_red', decor: 'elegant plum and magenta with gold accents and soft florals' },
  ramadan: { theme: 'navy_gold', decor: 'deep midnight navy-purple with gold crescent and lantern motifs and a warm lantern glow' },
  gergaoon: { theme: 'festive_red', decor: 'joyful turquoise, pink and gold with traditional Gulf patterns and little sweet bags' },
  eid_fitr: { theme: 'emerald_gold', decor: 'emerald green and gold with elegant Islamic geometric patterns' },
  eid_adha: { theme: 'emerald_gold', decor: 'emerald green and warm gold with elegant Islamic geometric patterns' },
  wedding_season: { theme: 'white_minimal', decor: 'ivory, blush pink and champagne gold with soft florals' },
  mothers_day: { theme: 'white_minimal', decor: 'soft rose pink and rose gold with fresh flowers' },
  graduation: { theme: 'navy_gold', decor: 'royal navy and gold with graduation caps and confetti' },
  back_to_school: { theme: 'navy_gold', decor: 'bright sky blue and sunny yellow with navy accents, cheerful classroom energy' },
  teachers_day: { theme: 'navy_gold', decor: 'bright sky blue and warm gold with chalkboard and apple motifs' },
  new_year: { theme: 'black_gold', decor: 'midnight navy-black with silver and gold sparkles' },
  diwali: { theme: 'festive_red', decor: 'warm saffron, magenta and gold with glowing diya lights' },
  onam: { theme: 'festive_red', decor: 'marigold yellow and orange floral pookalam colours' },
  // audiences
  companies: { theme: 'black_gold', decor: 'deep navy-charcoal and brushed gold, clean corporate' },
  event_organizers: { theme: 'black_gold', decor: 'deep navy-charcoal with gold spotlights, professional event mood' },
  schools: { theme: 'navy_gold', decor: 'bright sky blue and sunny yellow with navy accents' },
  students: { theme: 'navy_gold', decor: 'vibrant blue, yellow and coral, youthful and energetic' },
  families: { theme: 'navy_gold', decor: 'warm navy with soft gold and cosy home tones' },
  couples_weddings: { theme: 'white_minimal', decor: 'ivory, blush pink and champagne gold with soft florals' },
  gift_buyers: { theme: 'festive_red', decor: 'rich red and gold gift-wrap tones with satin ribbons' },
  restaurants_cafes: { theme: 'black_gold', decor: 'warm espresso brown, cream and gold' },
};
/** Product-category colour story (the «idea» of the product) when there is no occasion or audience. */
const CATEGORY_PALETTES: [RegExp, keyof typeof PALETTES | { decor: string; theme: (typeof PALETTES)[string]['theme'] }][] = [
  [/أعراس|حفلات|مناسبات/, 'couples_weddings'],
  [/أطفال|مدارس|تعليم/, 'schools'],
  [/شركات|موظف|مكتب|عقار|معارض|مؤتمر|مخازن/, 'companies'],
  [/مطاعم|مقاهي/, 'restaurants_cafes'],
  [/هدايا|أكواب/, 'gift_buyers'],
  [/فاخر/, { theme: 'black_gold', decor: 'black velvet and brushed gold foil, luxury stationery mood' }],
  [/عطور|بخور|شموع/, { theme: 'black_gold', decor: 'deep plum-black with warm amber candlelight and gold' }],
  [/رياض|بطول|فرق/, { theme: 'navy_gold', decor: 'energetic royal blue and bright green stadium tones with gold' }],
  [/حملات|مبادرات/, { theme: 'emerald_gold', decor: 'fresh teal and green community tones with gold' }],
  [/منزلية/, { theme: 'festive_red', decor: 'warm terracotta, cream and gold, homemade feel' }],
  [/واجهات|بنرات|لوحات|ملصقات/, { theme: 'navy_gold', decor: 'bold royal blue and sunny yellow street-signage energy with gold' }],
];
export function paletteFor(d: { occasion?: string; segment?: string }, categoryName?: string) {
  const byCat = () => {
    if (!categoryName) return null;
    const hit = CATEGORY_PALETTES.find(([re]) => re.test(categoryName))?.[1];
    return !hit ? null : typeof hit === 'string' ? PALETTES[hit] : hit;
  };
  return (d.occasion && d.occasion !== 'everyday' && PALETTES[d.occasion]) || (d.segment && PALETTES[d.segment]) || byCat() || null;
}

/** Compositions safe for the layered templates (text zones top and bottom). */
export const LAYERED_COMPOSITIONS = ['hero_product', 'in_context', 'flat_lay', 'lifestyle'];

export const CHANNELS = [
  { value: 'instagram', ar: 'إنستغرام', video: false },
  { value: 'facebook', ar: 'فيسبوك', video: false },
  { value: 'tiktok', ar: 'تيك توك', video: false },
  { value: 'threads', ar: 'ثريدز', video: false },
  { value: 'youtube', ar: 'يوتيوب شورتس (فيديو فقط)', video: true },
  { value: 'pinterest', ar: 'بنترست (يحتاج لوحة في إعدادات الحساب)', video: false },
  { value: 'linkedin', ar: 'لينكدإن', video: false },
  { value: 'twitter', ar: 'X (تويتر)', video: false },
  { value: 'gmb', ar: 'ملف Google التجاري (خرائط وبحث Google)', video: false },
] as const;
export type Channel = (typeof CHANNELS)[number]['value'];

export const REEL_STYLES = [
  { value: 'standard', ar: 'عادي — مشهد واحد بحركة كاميرا', scenes: 1 },
  { value: 'pro', ar: 'احترافي — عدة مشاهد بانتقالات سينمائية', scenes: 0 }, // 0 = depends on duration
] as const;
export const REEL_DURATIONS = [7, 10, 15, 20, 30] as const;
/** Pro reels: number of AI scenes for a duration (each costs one image generation). */
export const proSceneCount = (sec: number) => (sec <= 10 ? 2 : sec <= 20 ? 3 : 4);

export const AUDIO_TYPES = [
  { value: 'none', ar: 'بدون صوت (صامت)' },
  { value: 'ambient', ar: 'موسيقى هادئة (مولدة — خالية من الحقوق)' },
  { value: 'upbeat', ar: 'إيقاع حماسي (مولد — خالٍ من الحقوق)' },
  { value: 'library', ar: 'موسيقى من مكتبتك المرخّصة (تتنوع تلقائيًا)' },
  { value: 'voiceover', ar: 'تعليق صوتي احترافي + موسيقى' },
  { value: 'instagram', ar: 'صوت من مكتبة إنستغرام (عبر Metricool)' },
] as const;
export type AudioType = (typeof AUDIO_TYPES)[number]['value'];

export const RENDER_MODES = [
  { value: 'ai_full', ar: 'تصميم كامل بالذكاء الاصطناعي (مثل ChatGPT)' },
  { value: 'layered', ar: 'قالب بطبقات ثابتة (نص مضمون 100%)' },
] as const;

export const LANGUAGES = [
  { value: 'ar', ar: 'العربية', en: 'Arabic' },
  { value: 'en', ar: 'الإنجليزية', en: 'English' },
  { value: 'ml', ar: 'المالايالامية', en: 'Malayalam' },
] as const;

export interface Direction {
  contentType?: string; market?: string; segment?: string; occasion?: string; idea?: string;
  designType?: string; designStyle?: string; layout?: 'gold-poster' | 'navy-gold-classic' | 'gold-frame-lower';
  /** layered = deterministic text layers (100% verified); ai_full = the image model designs the whole poster like ChatGPT. */
  renderMode?: 'layered' | 'ai_full' | 'auto'; customPrompt?: string; autoFormat?: boolean;
  /** campaign: auto-pick products only from this category */
  categoryId?: string;
  /** resolved art recipe (system-picked) */
  art?: Art;
  channels?: Channel[];
  reelStyle?: 'standard' | 'pro'; reelDuration?: number; audio?: AudioType; audioQuery?: string;
  /** Reel engine for this design (default from AI settings): ffmpeg = motion from stills, veo = Gemini AI video. */
  videoEngine?: 'ffmpeg' | 'veo';
  /** Which fields the planner filled automatically (for analytics / transparency). */
  autoPicked?: string[];
}

const find = (list: Opt[], v?: string) => (v ? list.find((o) => o.value === v) : undefined);
export const findOccasion = (v?: string) => (v ? OCCASIONS.find((o) => o.value === v) : undefined);

/** English instructions for the AI built from the selected options (only selected ones). */
export function directionForPrompt(d?: Direction) {
  if (!d) return undefined;
  const out: Record<string, string> = {};
  const ct = find(CONTENT_TYPES, d.contentType); if (ct) out.contentType = ct.prompt;
  const mk = find(MARKETS, d.market); if (mk) out.marketAndAudience = mk.prompt;
  const sg = find(SEGMENTS, d.segment); if (sg) out.targetSegment = sg.prompt;
  const oc = findOccasion(d.occasion); if (oc) out.occasion = oc.prompt;
  const dt = find(DESIGN_TYPES, d.designType); if (dt) out.designType = dt.prompt;
  const ds = find(DESIGN_STYLES, d.designStyle); if (ds) out.visualStyle = ds.prompt;
  if (d.idea?.trim()) out.userIdea = d.idea.trim().slice(0, 500);
  if (d.art) {
    const c = find(DESIGN_TYPES, d.art.composition), l = LIGHTING.find((x) => x.value === d.art!.lighting), n = LENSES.find((x) => x.value === d.art!.lens);
    const parts = [c && `composition: ${c.prompt}`, l && `lighting: ${l.prompt}`, n && `camera: ${n.prompt}`].filter(Boolean);
    if (parts.length) out.art = parts.join('; ');
  }
  return Object.keys(out).length ? out : undefined;
}

/** Arabic summary for display on the ad page. */
export function directionSummaryAr(d?: Direction) {
  if (!d) return [];
  return [
    ['نوع المحتوى', find(CONTENT_TYPES, d.contentType)?.ar],
    ['الجمهور والسوق', find(MARKETS, d.market)?.ar],
    ['الفئة المستهدفة', find(SEGMENTS, d.segment)?.ar],
    ['المناسبة', findOccasion(d.occasion)?.ar],
    ['نوع التصميم', find(DESIGN_TYPES, d.designType)?.ar],
    ['أسلوب التصميم', find(DESIGN_STYLES, d.designStyle)?.ar],
    ['قنوات النشر', d.channels?.length ? d.channels.map((c) => CHANNELS.find((x) => x.value === c)?.ar ?? c).join('، ') : undefined],
    ['الريلز', d.reelStyle ? `${REEL_STYLES.find((x) => x.value === d.reelStyle)?.ar}${d.reelDuration ? ` · ${d.reelDuration} ث` : ''}` : d.reelDuration ? `${d.reelDuration} ث` : undefined],
    ['الصوت', d.audio ? `${AUDIO_TYPES.find((x) => x.value === d.audio)?.ar}${d.audioQuery ? ` — ${d.audioQuery}` : ''}` : undefined],
    ['فكرة المستخدم', d.idea?.trim() || undefined],
  ].filter((x): x is [string, string] => !!x[1]);
}

export const optionValues = (list: { value: string }[]) => list.map((o) => o.value) as [string, ...string[]];

export const styleOf = (v?: string) => DESIGN_STYLES.find((o) => o.value === v);
export const designTypeOf = (v?: string) => DESIGN_TYPES.find((o) => o.value === v);
