import type { MediaFormat } from '@prisma/client';

export const FORMAT_SIZE: Record<MediaFormat, { w: number; h: number }> = {
  IMAGE_STORY: { w: 1080, h: 1920 },
  REEL_VIDEO: { w: 1080, h: 1920 },
  IMAGE_FEED: { w: 1080, h: 1350 },
  IMAGE_SQUARE: { w: 1080, h: 1080 },
  IMAGE_CAROUSEL: { w: 1080, h: 1350 },
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

/**
 * Instagram safe zone for 1080×1920 (Stories and Reels). Instagram draws its own UI over the design:
 *  - top ~220 px: story progress bar + account name / «Reels» header
 *  - bottom ~380 px: Reels caption, @account and audio line / the story «send message» bar
 *  - right ~120 px (Reels, lower half): like, comment, share, audio icons
 * The profile grid shows a Reel cover cropped to 3:4 (y 240–1680). Logo, order button and phone numbers must
 * stay inside top..bottom and away from the right icons, or customers never see them.
 */
export const IG_SAFE_1920 = { top: 236, bottom: 1540, side: 120, gridTop: 240, gridBottom: 1680 } as const;

/** The template laid out for the canvas: 1920-high formats keep every brand element inside the Instagram safe zone. */
export function templateFor(key: string | null | undefined, h: number): Template {
  const t = getTemplate(key);
  if (h !== 1920) return t;
  const lower = t.key === 'gold-frame-lower';
  return {
    ...t,
    shade: lower ? [{ from: 0, to: 0.22, dir: 'down' }, { from: 0.3, to: 0.6, dir: 'up' }] : [{ from: 0, to: 0.47, dir: 'down' }],
    logo: { x: 0.33, y: 0.123, w: 0.34, h: 0.075 },
    headline: lower ? { ...t.headline, y: 0.4, h: 0.115 } : { ...t.headline, y: 0.205, h: 0.13 },
    support: lower ? { ...t.support, y: 0.52, h: 0.05 } : { ...t.support, y: 0.34, h: 0.055 },
    panel: { y: 0.6 },
    cta: { ...t.cta, y: 0.615, h: 0.055 },
    contacts: { y: 0.68, h: 0.115, gap: 0.03, padX: 0.11 },
  };
}

/** Layout choices for the UI. 'gold-poster' is the premium default for vertical (1080×1920) formats. */
export const LAYOUTS = [
  { value: 'gold-poster', ar: 'ملصق ذهبي فاخر (موصى به)' },
  { value: 'navy-gold-classic', ar: 'كلاسيكي بسيط' },
  { value: 'gold-frame-lower', ar: 'إطار ذهبي' },
] as const;

export const px = (b: Box, W: number, H: number) => ({ x: Math.round(b.x * W), y: Math.round(b.y * H), w: Math.round(b.w * W), h: Math.round(b.h * H) });
