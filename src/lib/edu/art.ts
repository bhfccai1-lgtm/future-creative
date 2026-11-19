import { PRESETS, type EduContent, type EduSettings } from './types';
import { resolveStyle } from './render';

/**
 * AI artwork for educational designs. The image model paints ONLY pictures — never text, letters or numbers
 * (titles, lessons, digits and equations are exact text layers drawn by the layout engine).
 */
export type Slot = { id: string; kind: 'cover' | 'background' | 'section' | 'gallery'; size: '1024x1024' | '1536x1024' | '1024x1536'; prompt: string; label: string };

const STYLE_ART: Record<ReturnType<typeof resolveStyle>, string> = {
  glossy: 'premium glossy 3D-cartoon illustration as in a top-quality printed school brochure: vivid but harmonious colours, bright blue sky with soft clouds, warm sunlight, crisp details, high dynamic range, polished commercial quality',
  kids_cartoon: 'cute 3D cartoon illustration for young children, soft rounded shapes, cheerful pastel colours, gentle lighting, Pixar-like quality',
  school_colorful: 'bright, colourful flat vector illustration, clean shapes, playful school atmosphere',
  luxury: 'elegant watercolour illustration with soft gold accents, refined, premium paper texture',
  minimal: 'minimal clean line-art illustration, two or three calm colours, lots of white space',
  three_d: 'high-quality 3D clay render, soft studio lighting, smooth materials',
  illustrated: 'detailed textbook illustration, hand-drawn look, accurate and clear',
  creative: 'modern isometric illustration, vibrant but balanced colours, professional design',
};
/**
 * Accurate visual descriptions of well-known Bahrain landmarks — image models invent shapes for named places,
 * so the real look is spelled out (shape, material, setting). Matched on the caption / description.
 */
export const LANDMARKS: [RegExp, string][] = [
  [/مركز البحرين التجاري|التجاري العالمي|world trade/i, 'the Bahrain World Trade Center in Manama: two identical tall sail-shaped glass towers facing each other, joined by three sky bridges each holding a large wind turbine, by the sea'],
  [/قلعة البحرين|قلعة البرتغال|bahrain fort|qal.?at/i, 'Qal\'at al-Bahrain (Bahrain Fort): a large sand-coloured stone fort with square towers and battlements on the northern coast, palm trees and the sea, Bahrain flag on a pole'],
  [/شجرة الحياة|tree of life/i, 'the Tree of Life in Bahrain: a single old, wide, leafy green mesquite (ghaf) tree standing alone on a small sandy hill in an empty desert, clear sky'],
  [/المتحف الوطني|national museum/i, 'the Bahrain National Museum: low modern white-travertine buildings with flat roofs and clean geometric lines beside the water of Muharraq bay'],
  [/باب البحرين|bab al.?bahrain/i, 'Bab Al Bahrain: the historic white two-storey gateway building with a wide arched entrance, Islamic arches and a flag, in old Manama souq'],
  [/جامع الفاتح|الفاتح|al.?fateh/i, 'Al Fateh Grand Mosque: a large mosque with one big sand-coloured dome (fibreglass, golden at the top) and two tall minarets, beige stone, palm trees'],
  [/قلعة عراد|arad fort/i, 'Arad Fort in Muharraq: a small square sand-coloured fort with round corner towers, surrounded by a dry moat, near the sea'],
  [/حلبة|circuit|الفورمولا/i, 'the Bahrain International Circuit in Sakhir desert: the race track and the tall modern tower with stacked levels'],
  [/لؤلؤ|الغوص|pearl/i, 'traditional Bahraini pearl diving: a wooden dhow on calm turquoise sea, oyster shells with natural pearls'],
  [/جسر الملك فهد|king fahd causeway/i, 'the King Fahd Causeway: a long bridge across the turquoise sea with the tall central tower on an island'],
];
export const landmarkDetail = (t: string) => LANDMARKS.find(([rx]) => rx.test(t))?.[1] ?? null;
/** one art direction shared by every picture of a project (they must look like one brochure) */
const ART_BIBLE = 'Consistent art direction for the whole brochure: soft sunlight from the upper left, the same bright blue sky with light clouds, the same colour grading and finish in every picture.';
const age = (grade: string) => { const m = grade.match(/\d+/); const g = m ? Number(m[0]) : /روضة|kg/i.test(grade) ? 0 : 4; return Math.max(5, Math.min(17, g + 5)); };
const CHARACTER = (kind: 'boy' | 'girl', grade: string) => kind === 'boy'
  ? `a friendly Bahraini schoolboy about ${age(grade)} years old in a white thobe and a white ghutra with a black agal, sitting at a wooden desk with an open book and a cup of coloured pencils, chin on his hand, looking up with a thoughtful smile`
  : `a friendly Bahraini schoolgirl about ${age(grade)} years old in a modest school uniform with a white hijab, sitting at a wooden desk with an open book and a cup of coloured pencils, chin on her hand, looking up with a thoughtful smile`;

const NO_TEXT = 'ABSOLUTELY NO text, letters, words, numbers, digits, equations, symbols, labels, logos or watermarks anywhere in the image.';

function subjectRules(s: EduSettings) {
  if (/إسلام|دين|قرآن|islam/i.test(s.subject)) return 'Islamic studies: show ONLY Islamic geometric patterns, arabesque ornaments, a mosque, an open book on a stand, prayer beads, lanterns or nature. NEVER draw people, faces, hands, angels, prophets or any living beings.';
  if (/رياضيات|math/i.test(s.subject)) return 'Maths: friendly geometric shapes, counting objects (blocks, apples, beads), rulers and abacus — but NO written digits or signs.';
  if (/علوم|science/i.test(s.subject)) return 'Science: scientifically accurate depiction (correct anatomy, plants, water cycle, planets, lab tools); no fantasy errors.';
  if (/اجتماعي|تاريخ|جغراف|social|history|geograph/i.test(s.subject)) return 'Social studies: culturally accurate Bahrain/Gulf scenes and landmarks where relevant; maps only as soft shapes without any labels.';
  return 'Culturally appropriate for schools in Bahrain; modest clothing for any people shown.';
}

/** Slots the current settings ask for (cover · one background per face · one illustration per section). */
export function plannedSlots(s: EduSettings, c: EduContent): Slot[] {
  const st = STYLE_ART[resolveStyle(s)], eng = PRESETS[s.type].engine, rules = subjectRules(s);
  const topic = `"${c.title || s.lesson}" (${s.subject}, ${s.grade})`;
  const landscape = s.orientation === 'landscape';
  const out: Slot[] = [];
  const islamic = /إسلام|دين|قرآن|islam/i.test(s.subject);
  if (s.images !== 'none' && ['panels', 'poster', 'cover'].includes(eng)) {
    const glossy = resolveStyle(s) === 'glossy';
    out.push({ id: 'cover', kind: 'cover', size: glossy && eng === 'panels' ? '1024x1536' : '1024x1024', label: 'صورة الغلاف', prompt: [
      glossy ? `A rich, complete cover scene for a school lesson about ${topic}: the main subject in the foreground, a meaningful setting behind it (Bahrain / Gulf where relevant), depth and atmosphere.` : `A single central educational illustration for a school lesson about ${topic}.`,
      s.coverCharacter !== 'none' && !islamic ? `In the lower foreground: ${CHARACTER(s.coverCharacter, s.grade)} — appealing Pixar-like 3D character, natural proportions.` : '',
      landmarkDetail(`${c.title} ${s.lesson}`) ? `Where it fits, show accurately: ${landmarkDetail(`${c.title} ${s.lesson}`)}.` : '',
      `Style: ${st}.`, ART_BIBLE, rules, glossy ? `Vertical composition; keep the top 15 % calm sky (a title is placed there by the layout)${s.coverCharacter !== 'none' && !islamic ? ' and leave the bottom 18 % simple (name cards are placed there)' : ''}.` : 'Subject centred, on a plain very light background, no frame.', NO_TEXT].filter(Boolean).join(' ') });
  }
  if (s.aiBackground) {
    const faces = eng === 'panels' ? 2 : 1;
    for (let i = 0; i < faces; i++) out.push({ id: `bg:${i}`, kind: 'background', size: landscape ? '1536x1024' : '1024x1536', label: faces > 1 ? `خلفية الوجه ${i + 1}` : 'خلفية الصفحة', prompt: [
      `A soft decorative background artwork for a printed school ${PRESETS[s.type].en.toLowerCase()} about ${topic}.`, `Style: ${st}.`, rules,
      'Low contrast, light and airy colours, the motifs only around the edges and corners; the large central area must stay calm and almost plain so text can be printed over it.', ART_BIBLE, NO_TEXT].join(' ') });
  }
  if (s.images === 'rich') {
    for (const sec of c.sections.slice(0, 8)) out.push({ id: `sec:${sec.id}`, kind: 'section', size: '1536x1024', label: `رسم: ${sec.heading}`, prompt: [
      `A clear educational illustration for the lesson part "${sec.heading}" of ${topic}.`, sec.image ? `It shows: ${sec.image}.` : sec.body ? `Context: ${sec.body.slice(0, 200)}.` : '',
      landmarkDetail(`${sec.heading} ${sec.image ?? ''}`) ? `Show accurately: ${landmarkDetail(`${sec.heading} ${sec.image ?? ''}`)}.` : '',
      `Style: ${st}.`, ART_BIBLE, rules, 'Wide composition, plain very light background, subject clearly visible.', NO_TEXT].filter(Boolean).join(' ') });
  }
  if (s.images === 'medium' || s.images === 'rich') {
    // picture grids: one picture per caption (the caption itself is real text under the picture); real places and
    // things look best as photographs in the glossy brochure, illustrations elsewhere
    const photo = s.galleryStyle === 'photo' || (s.galleryStyle === 'auto' && resolveStyle(s) === 'glossy' && !/رياضيات|math/i.test(s.subject));
    for (const sec of c.sections) for (const [i, g] of sec.gallery.slice(0, 6).entries()) out.push({ id: `gal:${sec.id}:${i}`, kind: 'gallery', size: '1024x1024', label: `صورة: ${g.caption}`, prompt: [
      `A clear, faithful picture of «${g.caption}» for a school lesson about ${topic}.`, g.image ? `It shows: ${g.image}.` : '',
      landmarkDetail(`${g.caption} ${g.image ?? ''}`) ? `It is: ${landmarkDetail(`${g.caption} ${g.image ?? ''}`)}.` : '',
      photo ? 'Style: a realistic, high-quality travel-brochure photograph — natural colours, bright daylight, clear blue sky, crisp detail, eye-level view, the whole subject in the frame.' : `Style: ${st}.`,
      ART_BIBLE, rules, 'Realistic proportions and the real look of the place or thing; centred; no frame.', NO_TEXT].filter(Boolean).join(' ') });
  }
  return out;
}
