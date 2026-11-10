import type { MediaFormat } from '@prisma/client';

export const FORMAT_SIZE: Record<MediaFormat, { w: number; h: number }> = {
  IMAGE_STORY: { w: 1080, h: 1920 },
  REEL_VIDEO: { w: 1080, h: 1920 },
  IMAGE_FEED: { w: 1080, h: 1350 },
  IMAGE_SQUARE: { w: 1080, h: 1080 },
};

export interface Box { x: number; y: number; w: number; h: number } // fractions of canvas

export interface Template {
  key: string; name: string;
  shade: { from: number; to: number; dir: 'down' | 'up' }[];
  frame: boolean;
  logo: Box;
  headline: Box & { maxSize: number; minSize: number; maxLines: number };
  support: Box & { maxSize: number; minSize: number; maxLines: number };
  panel: { y: number };
  cta: Box & { maxSize: number; minSize: number };
  contacts: { y: number; h: number; gap: number; padX: number };
}

export const TEMPLATES: Template[] = [
  {
    key: 'navy-gold-classic', name: 'كلاسيكي كحلي وذهبي',
    shade: [{ from: 0, to: 0.38, dir: 'down' }], frame: false,
    logo: { x: 0.33, y: 0.03, w: 0.34, h: 0.085 },
    headline: { x: 0.06, y: 0.125, w: 0.88, h: 0.135, maxSize: 92, minSize: 50, maxLines: 2 },
    support: { x: 0.08, y: 0.265, w: 0.84, h: 0.06, maxSize: 44, minSize: 28, maxLines: 2 },
    panel: { y: 0.765 },
    cta: { x: 0.25, y: 0.783, w: 0.5, h: 0.058, maxSize: 52, minSize: 30 },
    contacts: { y: 0.858, h: 0.112, gap: 0.03, padX: 0.06 },
  },
  {
    key: 'gold-frame-lower', name: 'إطار ذهبي مع عنوان سفلي',
    shade: [{ from: 0, to: 0.16, dir: 'down' }, { from: 0.42, to: 0.77, dir: 'up' }], frame: true,
    logo: { x: 0.34, y: 0.035, w: 0.32, h: 0.08 },
    headline: { x: 0.07, y: 0.565, w: 0.86, h: 0.12, maxSize: 88, minSize: 48, maxLines: 2 },
    support: { x: 0.09, y: 0.69, w: 0.82, h: 0.055, maxSize: 42, minSize: 28, maxLines: 2 },
    panel: { y: 0.765 },
    cta: { x: 0.25, y: 0.783, w: 0.5, h: 0.058, maxSize: 52, minSize: 30 },
    contacts: { y: 0.858, h: 0.112, gap: 0.03, padX: 0.06 },
  },
];

export const getTemplate = (key?: string | null) => TEMPLATES.find((t) => t.key === key) ?? TEMPLATES[0];

/** Layout choices for the UI. 'gold-poster' is the premium default for vertical (1080×1920) formats. */
export const LAYOUTS = [
  { value: 'gold-poster', ar: 'ملصق ذهبي فاخر (موصى به)' },
  { value: 'navy-gold-classic', ar: 'كلاسيكي بسيط' },
  { value: 'gold-frame-lower', ar: 'إطار ذهبي' },
] as const;

export const px = (b: Box, W: number, H: number) => ({ x: Math.round(b.x * W), y: Math.round(b.y * H), w: Math.round(b.w * W), h: Math.round(b.h * H) });
