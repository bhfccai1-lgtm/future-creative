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
  { value: 'onam', ar: 'مهرجان أونام', en: 'Onam', prompt: 'Onam festival celebrated by the Malayali community — floral pookalam motifs', headlineEn: 'Happy Onam' },
  { value: 'diwali', ar: 'مهرجان ديوالي', en: 'Diwali', prompt: 'Diwali festival of lights — diyas and warm glowing light', headlineEn: 'Happy Diwali' },
];

export const LANGUAGES = [
  { value: 'ar', ar: 'العربية', en: 'Arabic' },
  { value: 'en', ar: 'الإنجليزية', en: 'English' },
  { value: 'ml', ar: 'المالايالامية', en: 'Malayalam' },
] as const;

export interface Direction {
  contentType?: string; market?: string; segment?: string; occasion?: string; idea?: string;
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
  if (d.idea?.trim()) out.userIdea = d.idea.trim().slice(0, 500);
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
    ['فكرة المستخدم', d.idea?.trim() || undefined],
  ].filter((x): x is [string, string] => !!x[1]);
}

export const optionValues = (list: { value: string }[]) => list.map((o) => o.value) as [string, ...string[]];
