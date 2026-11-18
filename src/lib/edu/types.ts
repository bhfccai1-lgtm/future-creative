import { z } from 'zod';

/**
 * EDUCATION MASTER AI — design types, page settings and the structured educational content.
 * School projects never carry the print shop's logo, phones, ads or watermarks (identity policy).
 */
export const EDU_TYPES = [
  'brochure', 'poster', 'worksheet', 'exercises', 'school_project', 'flashcards', 'booklet', 'classroom_labels',
  'certificate', 'teaching_aid', 'mind_map', 'table', 'activities', 'project_cover', 'custom',
] as const;
export type EduType = (typeof EDU_TYPES)[number];
export type Engine = 'panels' | 'poster' | 'worksheet' | 'cards' | 'certificate' | 'mindmap' | 'table' | 'cover';

export interface TypePreset {
  ar: string; en: string; engine: Engine; size: PaperSize; orientation: 'portrait' | 'landscape'; sides: 1 | 2; columns: number;
  /** which form options make sense for this type (the UI shows only these) */
  options: ('sides' | 'columns' | 'student' | 'school' | 'exercises' | 'cards' | 'images')[];
}
export const PRESETS: Record<EduType, TypePreset> = {
  brochure: { ar: 'مطوية تعليمية', en: 'Educational brochure', engine: 'panels', size: 'A4', orientation: 'landscape', sides: 2, columns: 3, options: ['student', 'school', 'exercises', 'images'] },
  poster: { ar: 'بوستر تعليمي', en: 'Educational poster', engine: 'poster', size: 'A4', orientation: 'landscape', sides: 1, columns: 3, options: ['columns', 'images'] },
  worksheet: { ar: 'ورقة عمل', en: 'Worksheet', engine: 'worksheet', size: 'A4', orientation: 'portrait', sides: 1, columns: 1, options: ['student', 'school', 'exercises', 'images'] },
  exercises: { ar: 'أوراق تمارين', en: 'Exercise sheets', engine: 'worksheet', size: 'A4', orientation: 'portrait', sides: 1, columns: 2, options: ['student', 'columns', 'exercises'] },
  school_project: { ar: 'مشروع مدرسي', en: 'School project', engine: 'poster', size: 'A4', orientation: 'portrait', sides: 1, columns: 1, options: ['student', 'school', 'columns', 'images'] },
  flashcards: { ar: 'بطاقات تعليمية', en: 'Flash cards', engine: 'cards', size: 'A4', orientation: 'portrait', sides: 2, columns: 2, options: ['cards', 'images'] },
  booklet: { ar: 'كتيب تعليمي', en: 'Booklet', engine: 'poster', size: 'A5', orientation: 'portrait', sides: 1, columns: 1, options: ['student', 'school', 'images'] },
  classroom_labels: { ar: 'ملصقات للفصول', en: 'Classroom labels', engine: 'cards', size: 'A4', orientation: 'portrait', sides: 1, columns: 2, options: ['cards'] },
  certificate: { ar: 'شهادة مدرسية', en: 'School certificate', engine: 'certificate', size: 'A4', orientation: 'landscape', sides: 1, columns: 1, options: ['student', 'school'] },
  teaching_aid: { ar: 'وسيلة تعليمية', en: 'Teaching aid', engine: 'poster', size: 'A3', orientation: 'portrait', sides: 1, columns: 1, options: ['columns', 'images'] },
  mind_map: { ar: 'خريطة ذهنية', en: 'Mind map', engine: 'mindmap', size: 'A4', orientation: 'landscape', sides: 1, columns: 1, options: [] },
  table: { ar: 'جدول تعليمي', en: 'Educational table', engine: 'table', size: 'A4', orientation: 'landscape', sides: 1, columns: 1, options: [] },
  activities: { ar: 'أنشطة تفاعلية للطباعة', en: 'Printable activities', engine: 'worksheet', size: 'A4', orientation: 'portrait', sides: 1, columns: 1, options: ['student', 'exercises', 'images'] },
  project_cover: { ar: 'غلاف مشروع', en: 'Project cover', engine: 'cover', size: 'A4', orientation: 'portrait', sides: 1, columns: 1, options: ['student', 'school', 'images'] },
  custom: { ar: 'تصميم مخصص', en: 'Custom design', engine: 'poster', size: 'A4', orientation: 'portrait', sides: 1, columns: 2, options: ['sides', 'columns', 'student', 'school', 'exercises', 'images'] },
};

export const PAPER_MM = { A3: [297, 420], A4: [210, 297], A5: [148, 210] } as const;
export type PaperSize = keyof typeof PAPER_MM | 'custom';

export const STYLES = ['creative', 'kids_cartoon', 'luxury', 'school_colorful', 'minimal', 'three_d', 'illustrated', 'auto'] as const;
export const STYLE_AR: Record<(typeof STYLES)[number], string> = { creative: 'إبداعي احترافي', kids_cartoon: 'كرتوني للأطفال', luxury: 'فاخر وأنيق', school_colorful: 'مدرسي ملون', minimal: 'بسيط ومنظم', three_d: 'ثلاثي الأبعاد', illustrated: 'رسوم تعليمية', auto: 'اختيار ذكي تلقائي' };

export const SettingsSchema = z.object({
  type: z.enum(EDU_TYPES),
  lang: z.enum(['ar', 'en', 'bi']).default('ar'),
  subject: z.string().trim().min(1).max(80),
  grade: z.string().trim().min(1).max(40),
  lesson: z.string().trim().min(2).max(160),
  objectives: z.string().trim().max(800).default(''),
  student: z.string().trim().max(80).default(''),
  classSection: z.string().trim().max(40).default(''),
  school: z.string().trim().max(120).default(''),
  size: z.enum(['A3', 'A4', 'A5', 'custom']).default('A4'),
  customMm: z.object({ w: z.number().min(50).max(1000), h: z.number().min(50).max(1000) }).optional(),
  orientation: z.enum(['portrait', 'landscape']).default('portrait'),
  sides: z.union([z.literal(1), z.literal(2)]).default(1),
  columns: z.number().int().min(1).max(4).default(1),
  style: z.enum(STYLES).default('auto'),
  palette: z.enum(['blue', 'green', 'purple', 'orange', 'navy_gold', 'pink']).default('blue'),
  detail: z.enum(['short', 'medium', 'detailed']).default('medium'),
  images: z.enum(['none', 'low', 'medium']).default('low'),
  fontScale: z.number().min(0.8).max(1.4).default(1),
  digits: z.enum(['arabic', 'latin']).default('arabic'),
  equationDir: z.enum(['rtl', 'ltr']).default('rtl'),
  exerciseCount: z.number().int().min(0).max(30).default(8),
  cardCount: z.number().int().min(2).max(24).default(8),
  marginMm: z.number().min(5).max(25).default(10),
  bleedMm: z.number().min(0).max(5).default(0),
  /** panel order per side for brochures (indexes into the 3 panels of that side) — editable by the user */
  panelOrder: z.array(z.array(z.number().int().min(0).max(2)).length(3)).length(2).optional(),
  /** commercial identity is OFF for school projects (never mixed in) */
  brand: z.boolean().default(false),
  /** worksheets: an extra answer-key page for the teacher */
  answerKey: z.boolean().default(false),
  /** font size chosen automatically so the content fills the page without overflowing (fontScale is then ignored) */
  autoFit: z.boolean().default(true),
});
export type EduSettings = z.infer<typeof SettingsSchema>;

const Exercise = z.object({ q: z.string().max(300), answer: z.string().max(120).default(''), kind: z.enum(['equation', 'text', 'blank', 'choice']).default('text'), choices: z.array(z.string().max(80)).max(4).default([]) });
const Example = z.object({ problem: z.string().max(300), steps: z.array(z.string().max(240)).max(6).default([]), answer: z.string().max(120).default('') });
export const SectionSchema = z.object({ id: z.string().max(40), heading: z.string().max(120), body: z.string().max(1200).default(''), bullets: z.array(z.string().max(240)).max(10).default([]), examples: z.array(Example).max(4).default([]), exercises: z.array(Exercise).max(30).default([]), image: z.string().max(300).default('') });
export const ContentSchema = z.object({
  title: z.string().max(140), subtitle: z.string().max(200).default(''), intro: z.string().max(800).default(''),
  objectives: z.array(z.string().max(200)).max(8).default([]),
  sections: z.array(SectionSchema).max(12).default([]),
  summary: z.array(z.string().max(240)).max(8).default([]),
  activity: z.object({ title: z.string().max(120), steps: z.array(z.string().max(240)).max(8) }).optional(),
  mindmap: z.object({ center: z.string().max(80), branches: z.array(z.object({ label: z.string().max(60), children: z.array(z.string().max(60)).max(4).default([]) })).max(8) }).optional(),
  table: z.object({ headers: z.array(z.string().max(60)).max(6), rows: z.array(z.array(z.string().max(120)).max(6)).max(14) }).optional(),
  cards: z.array(z.object({ front: z.string().max(120), back: z.string().max(240).default('') })).max(24).default([]),
  certificate: z.object({ title: z.string().max(80), reason: z.string().max(240), date: z.string().max(40).default(''), signer: z.string().max(80).default('') }).optional(),
});
export type EduContent = z.infer<typeof ContentSchema>;
export type EduSection = z.infer<typeof SectionSchema>;

/** Steps of the production workflow shown to the user (status comes only from what actually ran). */
export const STEPS = ['input', 'validate', 'plan', 'content', 'review', 'images', 'layout', 'preview', 'edit', 'export', 'qc', 'download'] as const;
export type StepId = (typeof STEPS)[number];
export type StepState = { id: StepId; status: 'pending' | 'running' | 'done' | 'warning' | 'failed' | 'skipped'; note?: string; at?: string };
