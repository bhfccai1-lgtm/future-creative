import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { finishPhoto } from '@/lib/creative/photo-finish';
import { recipeFor, recipePrompt, RECIPES } from '@/lib/creative/photo-recipes';
import { LENSES } from '@/lib/creative/options';

// a «product shot»: soft gradient background, a mug-like object with a printed band and fine detail
const shot = (bg = ['#2b3a55', '#c9a46a']) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="768"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></linearGradient></defs><rect width="512" height="768" fill="url(#g)"/><rect x="156" y="260" width="200" height="260" rx="24" fill="#f2efe8"/><rect x="156" y="330" width="200" height="70" fill="#1f6f8b"/>${Array.from({ length: 20 }, (_, i) => `<line x1="${170 + i * 9}" y1="345" x2="${170 + i * 9}" y2="385" stroke="#fff" stroke-width="1.5"/>`).join('')}</svg>`)).blur(1.2).png().toBuffer();
const lapVar = async (png: Buffer) => { const { data } = await sharp(png).greyscale().convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], offset: 128 }).raw().toBuffer({ resolveWithObject: true }); let s = 0, s2 = 0; for (const v of data) { s += v; s2 += v * v; } const m = s / data.length; return s2 / data.length - m * m; };

describe('professional photography: the product decides the shot, a measured retouch finishes it', () => {
  it('every product family has a full recipe whose lenses exist; products override their category where the object differs', () => {
    const known = new Set(LENSES.map((l) => l.value as string));
    for (const r of Object.values(RECIPES)) { expect(r.lenses.length, r.key).toBeGreaterThan(0); for (const l of r.lenses) expect(known.has(l), `${r.key}: ${l}`).toBe(true); }
    expect(recipeFor({ categorySlug: 'drinkware', slug: 'ceramic-mugs' }).lenses).not.toContain('overhead'); // no flat-lay for a mug
    expect(recipeFor({ categorySlug: 'large-format' }).lenses).toEqual(['35mm_context']); // a 2 m roll-up needs a wide environmental shot
    expect(recipeFor({ categorySlug: 'drinkware', slug: 'glass-mugs' }).light).toMatch(/backlight/);
    expect(recipeFor({ categorySlug: 'nope' }).key).toBe('default');
    expect(recipePrompt(RECIPES.drinkware)).toMatch(/^Camera .*\nLight set-up: .*\nSet and props: .*\nMaterial truth: /s);
  });

  it('the finish adds real clarity without new clipping or a brightness shift, and keeps transparency', async () => {
    const src = await shot();
    for (const g of ['neutral', 'warm', 'crisp', 'rich'] as const) {
      const r = await finishPhoto(src, g);
      expect(r.report.applied, g).toContain('clarity');
      expect(await lapVar(r.png), g).toBeGreaterThan(await lapVar(src)); // measurably crisper detail
      expect(r.report.clipAfter - r.report.clipBefore, g).toBeLessThanOrEqual(0.005);
      expect(r.report.meanShift, g).toBeLessThanOrEqual(0.04);
    }
    const cut = await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><circle cx="100" cy="100" r="60" fill="#c33"/></svg>') }]).png().toBuffer();
    const t = await finishPhoto(cut, 'rich');
    expect(t.report.applied).not.toContain('vignette'); // cut-outs stay clean
    expect((await sharp(t.png).metadata()).hasAlpha).toBe(true);
  });

  it('an already blown-out picture is left as it is (the retouch would clip it further)', async () => {
    const hot = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#fbfbfb"/>' + Array.from({ length: 30 }, (_, i) => `<rect x="${i * 10}" y="0" width="5" height="300" fill="#f0f0f0"/>`).join('') + '</svg>')).png().toBuffer();
    const r = await finishPhoto(hot, 'crisp');
    if (r.report.skipped) expect(r.png).toBe(hot);
    else expect(r.report.clipAfter - r.report.clipBefore).toBeLessThanOrEqual(0.005);
  });
});
