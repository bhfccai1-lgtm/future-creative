/**
 * Voice-over catalogue: 23 speaker personas × 73 languages / dialects (grouped by audience).
 * OpenAI voices are not native speakers of every dialect — the accent comes from (1) a script WRITTEN in that
 * dialect and (2) acting instructions. `q` is the honest expected quality; always preview before relying on it.
 */
export type OpenAiVoice = 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'fable' | 'nova' | 'onyx' | 'sage' | 'shimmer' | 'verse';
export interface Persona { id: string; group: string; ar: string; voice: OpenAiVoice; acting: string; pitch?: number; tempo?: number }
export interface VoiceLang { id: string; group: string; ar: string; prompt: string; q: 'excellent' | 'good' | 'medium' | 'weak' }

export const PERSONA_GROUPS: Record<string, string> = {
  ad: 'معلّقو الإعلانات', female: 'نسائية', male: 'رجالية', youth: 'شبابية', kids: 'أطفال', elder: 'كبار السن',
  broadcast: 'مذيعون', sports: 'رياضي', story: 'حكواتي', theatre: 'مسرحي', comedy: 'كوميدي', folk: 'شعبي',
};
export const PERSONAS: Persona[] = [
  { id: 'ad_male', group: 'ad', ar: 'معلّق إعلانات (رجل)', voice: 'onyx', acting: 'a top commercial voice-over artist: confident, warm, persuasive, polished studio delivery, a short pause before the call to action so it lands' },
  { id: 'ad_female', group: 'ad', ar: 'معلّقة إعلانات (امرأة)', voice: 'coral', acting: 'a top female commercial voice-over artist: bright, confident, persuasive and warm, a short pause before the call to action' },
  { id: 'f_young', group: 'female', ar: 'شابة حيوية', voice: 'nova', acting: 'a lively, cheerful young woman in her twenties, smiling while she speaks, energetic but natural' },
  { id: 'f_mother', group: 'female', ar: 'أم دافئة', voice: 'coral', acting: 'a warm, caring mother in her thirties, gentle and sincere, like sharing a lovely idea with family' },
  { id: 'f_elegant', group: 'female', ar: 'راقية فاخرة', voice: 'shimmer', acting: 'an elegant, refined woman presenting a luxury brand: soft, graceful, unhurried, premium' },
  { id: 'f_calm', group: 'female', ar: 'هادئة ومتزنة', voice: 'sage', acting: 'a calm, composed woman with a soothing, trustworthy tone, slow and clear' },
  { id: 'm_deep', group: 'male', ar: 'عميق واثق', voice: 'onyx', acting: 'a man with a deep, rich, confident voice, strong and reassuring, cinematic' },
  { id: 'm_warm', group: 'male', ar: 'دافئ ودود', voice: 'ash', acting: 'a friendly, warm man talking to a neighbour, relaxed and genuine' },
  { id: 'm_business', group: 'male', ar: 'رجل أعمال رسمي', voice: 'echo', acting: 'a professional businessman presenting to companies: articulate, credible, measured and formal' },
  { id: 'y_male', group: 'youth', ar: 'شاب عصري', voice: 'verse', acting: 'a trendy young man (about 20) talking like a social-media creator: upbeat, casual, fast-paced, fun' },
  { id: 'y_female', group: 'youth', ar: 'شابة مؤثرة', voice: 'nova', acting: 'a young female influencer (about 20) talking to her followers: excited, casual, expressive, fun' },
  { id: 'k_boy', group: 'kids', ar: 'طفل مرح', voice: 'verse', pitch: 1.28, tempo: 1.0, acting: 'a cheerful, excited 9-year-old boy, playful and innocent, simple words, big smile in the voice' },
  { id: 'k_girl', group: 'kids', ar: 'طفلة مرحة', voice: 'nova', pitch: 1.24, tempo: 1.0, acting: 'a sweet, cheerful 8-year-old girl, playful and delighted, simple words, giggly energy' },
  { id: 'e_grandpa', group: 'elder', ar: 'جد حكيم', voice: 'onyx', pitch: 0.94, tempo: 0.9, acting: 'a wise, kind grandfather in his seventies: slow, warm, slightly gravelly, full of affection and life experience' },
  { id: 'e_grandma', group: 'elder', ar: 'جدة حنونة', voice: 'sage', pitch: 0.96, tempo: 0.9, acting: 'a loving grandmother in her seventies: tender, slow, softly smiling, blessing her family' },
  { id: 'b_radio', group: 'broadcast', ar: 'مذيع إذاعي', voice: 'echo', acting: 'a popular radio presenter: crisp diction, friendly authority, smooth on-air rhythm' },
  { id: 'b_tv', group: 'broadcast', ar: 'مذيعة تلفزيونية', voice: 'shimmer', acting: 'a TV news and lifestyle presenter: clear, poised, articulate, confident' },
  { id: 's_commentator', group: 'sports', ar: 'معلّق رياضي', voice: 'verse', acting: 'an electrifying football match commentator: high energy, fast, rising excitement, passionate like a goal moment' },
  { id: 'hakawati', group: 'story', ar: 'حكواتي (راوٍ)', voice: 'fable', tempo: 0.95, acting: 'a traditional storyteller (hakawati) telling a tale of the old days: warm, rhythmic, suspenseful pauses, captivating' },
  { id: 'theatre', group: 'theatre', ar: 'أداء مسرحي', voice: 'ballad', acting: 'a stage actor giving a dramatic, expressive performance: dynamic contrast between a near-whisper and passionate peaks' },
  { id: 'comedy', group: 'comedy', ar: 'كوميدي خفيف الظل', voice: 'ash', acting: 'a light-hearted comedian: playful timing, gentle exaggeration, friendly teasing — tasteful, never mocking anyone' },
  { id: 'folk', group: 'folk', ar: 'شعبي ابن الفريج', voice: 'alloy', acting: 'a down-to-earth man from the old neighbourhood market: spontaneous, hearty, traditional and full of warmth' },
  { id: 'narrator', group: 'ad', ar: 'راوٍ وثائقي', voice: 'fable', acting: 'a documentary narrator: calm, rich, inspiring, measured pace' },
];

export const LANG_GROUPS: Record<string, string> = {
  arabic: 'عربية وخليجية', indian: 'الجالية الهندية', pakistani: 'الجالية الباكستانية', bangladeshi: 'الجالية البنغلاديشية', filipino: 'الجالية الفلبينية',
  nepali: 'الجالية النيبالية', srilankan: 'الجالية السريلانكية', african: 'أفريقية', european: 'أوروبية', russian: 'روسية وأوراسية', turkish: 'تركية',
  iranian: 'إيرانية', chinese: 'صينية', japanese: 'يابانية', asian: 'آسيوية', latin: 'لاتينية', american: 'أمريكية', canadian: 'كندية', australian: 'أسترالية',
};
const L = (id: string, group: string, ar: string, q: VoiceLang['q'], prompt: string): VoiceLang => ({ id, group, ar, q, prompt });
export const VOICE_LANGS: VoiceLang[] = [
  L('ar_bh', 'arabic', 'بحرينية', 'good', 'authentic Bahraini Arabic dialect (لهجة بحرينية), as spoken in Manama and Muharraq: pronounce ق as a hard "g" like Bahrainis, relaxed Gulf intonation with friendly rising endings; natural Bahraini words like وايد، الحين، شلون، تبي، حق، يا هلا. Never Egyptian, Levantine or news-style Arabic'),
  L('ar_kw', 'arabic', 'كويتية', 'good', 'authentic Kuwaiti Arabic dialect: Kuwaiti intonation and words like وايد، شلونك، عاد، ترى؛ ق as "g", ك sometimes as "ch"'),
  L('ar_sa', 'arabic', 'سعودية', 'good', 'Saudi Arabic (Najdi/Riyadh) dialect used in Saudi commercials: words like مرة حلو، يا هلا، وش، ابغى؛ ق as "g"'),
  L('ar_ae', 'arabic', 'إماراتية', 'good', 'Emirati Arabic dialect: calm Emirati intonation, words like شو، وايد، مب، حياك'),
  L('ar_qa', 'arabic', 'قطرية', 'good', 'Qatari Arabic dialect: Qatari intonation and words like زين، ترى، وايد'),
  L('ar_om', 'arabic', 'عُمانية', 'medium', 'Omani Arabic dialect with its distinctive gentle rhythm and Omani expressions'),
  L('ar_gulf', 'arabic', 'خليجية عامة', 'good', 'general Gulf Arabic understood across the GCC, neutral Gulf accent'),
  L('ar_eg', 'arabic', 'مصرية', 'excellent', 'Egyptian Arabic (Cairo) as in Egyptian TV commercials: ج as hard "g", ق as glottal stop, words like إزيك، أوي، عشان'),
  L('ar_levant', 'arabic', 'شامية', 'excellent', 'Levantine Arabic (Lebanese/Syrian/Jordanian/Palestinian) commercial style: soft Levantine intonation, words like كتير، هلق، شو'),
  L('ar_iq', 'arabic', 'عراقية', 'good', 'Iraqi Arabic (Baghdadi) dialect: Iraqi intonation, words like شلونك، هواية، كلش'),
  L('ar_sd', 'arabic', 'سودانية', 'medium', 'Sudanese Arabic dialect with Sudanese intonation and expressions'),
  L('ar_maghreb', 'arabic', 'مغاربية', 'medium', 'Maghrebi Arabic (Moroccan Darija style, softened to be understood by other Arabs)'),
  L('ar_msa', 'arabic', 'فصحى إعلانية', 'excellent', 'Modern Standard Arabic as used in premium pan-Arab TV commercials: clear, elegant, correct grammar, no regional slang'),
  L('ml', 'indian', 'مالايالامية', 'medium', 'Malayalam (Kerala) commercial voice-over, natural Malayali intonation'),
  L('hi', 'indian', 'هندية', 'good', 'Hindi (Indian TV commercial style), natural Hinglish-free Hindi'),
  L('ta_in', 'indian', 'تاميلية (الهند)', 'good', 'Tamil (Tamil Nadu) commercial voice-over'),
  L('ur_in', 'indian', 'أردية (هندية)', 'good', 'Urdu with an Indian (Hyderabadi/Lucknowi) accent'),
  L('en_in', 'indian', 'إنجليزية بلكنة هندية', 'excellent', 'English with a natural Indian accent, like Indian English TV ads'),
  L('ur_pk', 'pakistani', 'أردية باكستانية', 'good', 'Urdu with a Pakistani accent, like Pakistani TV commercials (words like جناب، بہترین)'),
  L('pa', 'pakistani', 'بنجابية', 'medium', 'Punjabi (Pakistani Punjabi, Shahmukhi-origin pronunciation), friendly and warm'),
  L('ps', 'pakistani', 'بشتو', 'weak', 'Pashto (Pakistani/Afghan), respectful and warm'),
  L('en_pk', 'pakistani', 'إنجليزية بلكنة باكستانية', 'excellent', 'English with a natural Pakistani accent'),
  L('bn_bd', 'bangladeshi', 'بنغالية بنغلاديشية', 'medium', 'Bengali as spoken in Bangladesh (Dhaka), not Kolkata style; words like ভাই، আপনার জন্য'),
  L('en_bd', 'bangladeshi', 'إنجليزية بلكنة بنغلاديشية', 'good', 'English with a natural Bangladeshi accent'),
  L('tl', 'filipino', 'تاغالوغ', 'medium', 'Tagalog (Filipino), friendly Filipino TV commercial style, e.g. "Kabayan!"'),
  L('taglish', 'filipino', 'تاغلش (تاغالوغ + إنجليزي)', 'good', 'Taglish — natural mix of Tagalog and English exactly how Filipinos in the Gulf talk'),
  L('en_ph', 'filipino', 'إنجليزية بلكنة فلبينية', 'excellent', 'English with a natural Filipino accent'),
  L('ne', 'nepali', 'نيبالية', 'medium', 'Nepali, friendly and respectful (दाइ، दिदी)'),
  L('en_np', 'nepali', 'إنجليزية بلكنة نيبالية', 'good', 'English with a natural Nepali accent'),
  L('si', 'srilankan', 'سنهالية', 'weak', 'Sinhala (Sri Lanka), warm commercial style'),
  L('ta_lk', 'srilankan', 'تاميلية سريلانكية', 'medium', 'Sri Lankan Tamil (Jaffna-style pronunciation), different from Indian Tamil'),
  L('en_lk', 'srilankan', 'إنجليزية بلكنة سريلانكية', 'good', 'English with a natural Sri Lankan accent'),
  L('sw', 'african', 'سواحيلية', 'medium', 'Swahili (Kenya/Tanzania), friendly East African commercial style'),
  L('am', 'african', 'أمهرية', 'weak', 'Amharic (Ethiopia), warm and respectful'),
  L('so', 'african', 'صومالية', 'weak', 'Somali, warm and respectful'),
  L('en_eaf', 'african', 'إنجليزية شرق أفريقية', 'excellent', 'English with a natural Kenyan/Ugandan accent'),
  L('en_waf', 'african', 'إنجليزية غرب أفريقية', 'excellent', 'English with a natural Nigerian/Ghanaian accent'),
  L('fr_af', 'african', 'فرنسية أفريقية', 'good', 'French with a West/Central African accent'),
  L('en_gb', 'european', 'إنجليزية بريطانية', 'excellent', 'British English (Received Pronunciation), premium UK commercial style'),
  L('fr', 'european', 'فرنسية', 'excellent', 'French (Paris), elegant commercial style'),
  L('de', 'european', 'ألمانية', 'excellent', 'German, clear and trustworthy commercial style'),
  L('it', 'european', 'إيطالية', 'excellent', 'Italian, warm and stylish commercial style'),
  L('es', 'european', 'إسبانية (إسبانيا)', 'excellent', 'Castilian Spanish (Spain) commercial style'),
  L('pt_pt', 'european', 'برتغالية (البرتغال)', 'excellent', 'European Portuguese (Lisbon) commercial style'),
  L('ru', 'russian', 'روسية', 'excellent', 'Russian, confident commercial style'),
  L('uk', 'russian', 'أوكرانية', 'good', 'Ukrainian, warm commercial style'),
  L('kk', 'russian', 'كازاخية', 'medium', 'Kazakh, friendly commercial style'),
  L('uz', 'russian', 'أوزبكية', 'medium', 'Uzbek, friendly commercial style'),
  L('tr', 'turkish', 'تركية', 'excellent', 'Turkish (Istanbul), Turkish TV commercial style'),
  L('tr_drama', 'turkish', 'تركية بأسلوب الدراما', 'excellent', 'Turkish in an emotional Turkish-drama style, heartfelt and romantic'),
  L('az', 'turkish', 'أذربيجانية', 'medium', 'Azerbaijani, warm commercial style'),
  L('fa', 'iranian', 'فارسية', 'good', 'Persian (Tehrani), Iranian commercial style'),
  L('fa_poetic', 'iranian', 'فارسية بأسلوب شعري', 'good', 'Persian in a refined literary, poetic style (suits gifts, Nowruz, luxury)'),
  L('ar_ahwazi', 'iranian', 'عربية أهوازية', 'medium', 'Arabic with an Ahwazi / Gulf-Iranian accent, close to southern Iraqi and Gulf Arabic'),
  L('zh_cn', 'chinese', 'صينية (ماندرين)', 'excellent', 'Mandarin Chinese (Beijing standard), Chinese commercial style'),
  L('zh_tw', 'chinese', 'ماندرين تايوانية', 'good', 'Taiwanese Mandarin, softer Taiwanese intonation'),
  L('yue', 'chinese', 'كانتونية', 'medium', 'Cantonese (Hong Kong) commercial style'),
  L('ja_formal', 'japanese', 'يابانية رسمية', 'excellent', 'Japanese, polite keigo, premium Japanese commercial style'),
  L('ja_casual', 'japanese', 'يابانية عصرية', 'excellent', 'Japanese, cheerful casual youth commercial style (kawaii energy)'),
  L('ko', 'asian', 'كورية', 'excellent', 'Korean (Seoul), Korean commercial style'),
  L('id', 'asian', 'إندونيسية', 'good', 'Indonesian, friendly commercial style'),
  L('ms', 'asian', 'ماليزية', 'good', 'Malay (Malaysia), friendly commercial style'),
  L('th', 'asian', 'تايلاندية', 'medium', 'Thai, polite friendly commercial style'),
  L('vi', 'asian', 'فيتنامية', 'medium', 'Vietnamese (Northern standard), friendly commercial style'),
  L('es_mx', 'latin', 'إسبانية مكسيكية', 'excellent', 'Mexican Spanish, Latin American commercial style'),
  L('es_ar', 'latin', 'إسبانية أرجنتينية', 'excellent', 'Argentinian Spanish (rioplatense accent, voseo)'),
  L('pt_br', 'latin', 'برتغالية برازيلية', 'excellent', 'Brazilian Portuguese, warm Brazilian commercial style'),
  L('en_us_ad', 'american', 'أمريكية إعلانية', 'excellent', 'General American English, classic confident US commercial announcer style'),
  L('en_us_social', 'american', 'أمريكية للسوشال ميديا', 'excellent', 'American English, casual social-media creator style'),
  L('en_ca', 'canadian', 'إنجليزية كندية', 'excellent', 'Canadian English, friendly and polite'),
  L('fr_ca', 'canadian', 'فرنسية كندية (كيبيك)', 'good', 'Québécois French with Québec pronunciation and expressions'),
  L('en_au', 'australian', 'إنجليزية أسترالية', 'excellent', 'Australian English, friendly and upbeat ("G\'day", "mate")'),
  L('en_nz', 'australian', 'إنجليزية نيوزيلندية', 'excellent', 'New Zealand English, friendly and relaxed'),
];
export const Q_AR: Record<VoiceLang['q'], string> = { excellent: 'ممتازة', good: 'جيدة', medium: 'متوسطة — اسمع العينة', weak: 'ضعيفة — العينة ضرورية' };
export const personaOf = (id?: string) => PERSONAS.find((p) => p.id === id);
export const voiceLangOf = (id?: string) => VOICE_LANGS.find((l) => l.id === id);

/** «تلقائي»: language from the audience/market and the design language. */
export function autoVoiceLang(o: { market?: string | null; contentLang: 'ar' | 'en' | 'ml' }): string {
  const m: Record<string, string> = { bahrain_local: 'ar_bh', bahrain_business: 'ar_bh', gcc_saudi: 'ar_sa', indian_community: 'ml', english_expats: 'en_gb' };
  if (o.market && m[o.market]) return o.contentLang === 'en' && o.market === 'indian_community' ? 'en_in' : m[o.market];
  return o.contentLang === 'en' ? 'en_gb' : o.contentLang === 'ml' ? 'ml' : 'ar_bh';
}
/** «تلقائي»: persona from the product category, rotating between the suitable ones. */
export function autoPersona(categoryName: string, recent: string[]): string {
  const c = categoryName;
  const pool = /رياض|بطول|فرق/.test(c) ? ['s_commentator']
    : /أطفال|مدارس|مدرس/.test(c) ? ['k_girl', 'k_boy']
    : /أعراس|حفلات|فاخر|عطور|بخور|شموع/.test(c) ? ['f_elegant', 'ad_female', 'theatre']
    : /شركات|موظف|مكتب|عقار|معارض|مؤتمر|مخازن/.test(c) ? ['ad_male', 'm_business', 'b_radio']
    : /هدايا الشخصية|تذكار/.test(c) ? ['f_mother', 'hakawati', 'e_grandma']
    : /منزلية|شعبي/.test(c) ? ['folk', 'f_mother']
    : /مطاعم|مقاهي|واجهات|محلات/.test(c) ? ['y_female', 'ad_male', 'comedy']
    : ['ad_male', 'ad_female', 'f_young', 'm_warm'];
  return pool.find((p) => !recent.includes(p)) ?? pool[recent.length % pool.length];
}
/** Spoken words per second for a natural ad read (used to size the script to the reel). */
export const wordsFor = (sec: number, persona?: Persona) => Math.max(6, Math.round(sec * 2.2 * (persona?.tempo ?? 1) * (persona?.group === 'sports' ? 1.25 : 1)));
