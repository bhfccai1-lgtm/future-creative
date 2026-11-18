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
  if (s.images !== 'none' && ['panels', 'poster', 'cover'].includes(eng)) {
    const glossy = resolveStyle(s) === 'glossy';
    out.push({ id: 'cover', kind: 'cover', size: glossy && eng === 'panels' ? '1024x1536' : '1024x1024', label: 'صورة الغلاف', prompt: [
      glossy ? `A rich, complete cover scene for a school lesson about ${topic}: the main subject in the foreground, a meaningful setting behind it (Bahrain / Gulf where relevant), depth and atmosphere.` : `A single central educational illustration for a school lesson about ${topic}.`,
      `Style: ${st}.`, rules, glossy ? 'Vertical composition; keep the top 15 % calm sky (a title is placed there by the layout).' : 'Subject centred, on a plain very light background, no frame.', NO_TEXT].join(' ') });
  }
  if (s.aiBackground) {
    const faces = eng === 'panels' ? 2 : 1;
    for (let i = 0; i < faces; i++) out.push({ id: `bg:${i}`, kind: 'background', size: landscape ? '1536x1024' : '1024x1536', label: faces > 1 ? `خلفية الوجه ${i + 1}` : 'خلفية الصفحة', prompt: [
      `A soft decorative background artwork for a printed school ${PRESETS[s.type].en.toLowerCase()} about ${topic}.`, `Style: ${st}.`, rules,
      'Low contrast, light and airy colours, the motifs only around the edges and corners; the large central area must stay calm and almost plain so text can be printed over it.', NO_TEXT].join(' ') });
  }
  if (s.images === 'rich') {
    for (const sec of c.sections.slice(0, 8)) out.push({ id: `sec:${sec.id}`, kind: 'section', size: '1536x1024', label: `رسم: ${sec.heading}`, prompt: [
      `A clear educational illustration for the lesson part "${sec.heading}" of ${topic}.`, sec.image ? `It shows: ${sec.image}.` : sec.body ? `Context: ${sec.body.slice(0, 200)}.` : '',
      `Style: ${st}.`, rules, 'Wide composition, plain very light background, subject clearly visible.', NO_TEXT].filter(Boolean).join(' ') });
  }
  if (s.images === 'medium' || s.images === 'rich') {
    // picture grids: one picture per caption (the caption itself is real text under the picture)
    for (const sec of c.sections) for (const [i, g] of sec.gallery.slice(0, 6).entries()) out.push({ id: `gal:${sec.id}:${i}`, kind: 'gallery', size: '1024x1024', label: `صورة: ${g.caption}`, prompt: [
      `A clear, faithful picture of «${g.caption}» for a school lesson about ${topic}.`, g.image ? `It shows: ${g.image}.` : '',
      `Style: ${st}.`, rules, 'Realistic proportions and the real look of the place or thing; centred; no frame.', NO_TEXT].filter(Boolean).join(' ') });
  }
  return out;
}
