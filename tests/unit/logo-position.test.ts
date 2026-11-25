import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { composeAdvertisement } from '@/lib/render/compose';
import { designDirection, EMPTY_DESIGN } from '@/lib/creative/design-direction';

const logo = () => sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="260"><circle cx="250" cy="130" r="120" fill="#f5a623"/></svg>')).png().toBuffer();
const poster = () => sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536"><rect width="1024" height="1536" fill="#13265a"/><rect x="380" y="500" width="260" height="400" fill="#f4f1ea"/></svg>')).png().toBuffer();
const compose = async (logoPosition: string) => composeAdvertisement({
  scene: await poster(), format: 'IMAGE_STORY', lang: 'ar', templateKey: 'ai-poster', headline: 'x', cta: 'اطلب الآن', logo: await logo(),
  contacts: [{ key: 'saar', label: 'سار', phone: '33316319' }], logoPosition, brandName: 'مركز إبداع المستقبل',
});

describe('full-AI poster: the original logo goes where the design needs it', () => {
  it('centred by default, in either top corner, or centred with the centre’s name typed under it', async () => {
    const at = async (p: string) => { const c = await compose(p); const l = c.manifest.layers.find((x) => x.id === 'logo')!; return { cx: l.rect.left + l.rect.width / 2, w: l.rect.width, c }; };
    const centre = await at('auto'), right = await at('top-right'), left = await at('top-left'), named = await at('top-center-name');
    expect(Math.abs(centre.cx - 540)).toBeLessThan(4);
    expect(right.cx).toBeGreaterThan(780); // right corner (Arabic reading start)
    expect(left.cx).toBeLessThan(300);
    expect(right.w).toBeLessThan(centre.w); // a corner logo is smaller: the stage belongs to the design
    const brand = named.c.manifest.layers.find((x) => x.id === 'brand');
    expect(brand?.text).toBe('مركز إبداع المستقبل'); // typed by the system, exact spelling
    expect(brand?.fits).toBe(true);
    expect(centre.c.manifest.layers.some((x) => x.id === 'brand')).toBe(false); // no name unless asked
  });

  it('«bottom centre between the branches» (the owner\'s sketch): logo centred in the footer, never over a number or the order button', async () => {
    const meets = (a: { left: number; top: number; width: number; height: number }, b: typeof a) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
    for (const format of ['IMAGE_STORY', 'IMAGE_FEED', 'IMAGE_SQUARE'] as const) {
      const c = await composeAdvertisement({
        scene: await poster(), format, lang: 'ar', templateKey: 'ai-poster', headline: 'x', cta: 'اطلب الآن', logo: await logo(),
        contacts: [{ key: 'saar', label: 'فرع سار', phone: '33316319' }, { key: 'salmabad', label: 'فرع سلماباد', phone: '34315316' }], logoPosition: 'bottom-center',
      });
      const L = c.manifest.layers, lg = L.find((x) => x.id === 'logo')!.rect, cta = L.find((x) => x.id === 'cta')!.rect;
      expect(Math.abs(lg.left + lg.width / 2 - 540), format).toBeLessThan(4);
      expect(lg.top, format).toBeGreaterThan(c.height * 0.6); // in the footer, not at the top
      expect(meets(lg, cta), `${format}: logo meets the order button`).toBe(false);
      for (const ph of L.filter((x) => x.id.startsWith('contact:'))) expect(meets(lg, ph.rect), `${format}: logo meets ${ph.id}`).toBe(false);
      const saar = L.find((x) => x.id === 'contact:saar:phone')!.rect, salm = L.find((x) => x.id === 'contact:salmabad:phone')!.rect;
      expect(saar.left).toBeGreaterThan(lg.left + lg.width - 1); // Arabic: Saar on the right of the logo
      expect(salm.left + salm.width).toBeLessThan(lg.left + 1);   // Salmabad on the left
    }
  });

  it('the create form sends the logo position for AI designs and the fixed template only for the template method', () => {
    expect(designDirection({ ...EMPTY_DESIGN, renderMode: 'ai_full', logoPosition: 'top-right', layout: 'gold-frame-lower' }, 'IMAGE_FEED')).toMatchObject({ renderMode: 'ai_full', logoPosition: 'top-right' });
    expect(designDirection({ ...EMPTY_DESIGN, renderMode: 'ai_full', layout: 'gold-frame-lower' }, 'IMAGE_FEED')).not.toHaveProperty('layout');
    expect(designDirection({ ...EMPTY_DESIGN, renderMode: 'layered', layout: 'gold-frame-lower', logoPosition: 'top-right' }, 'IMAGE_FEED')).toMatchObject({ layout: 'gold-frame-lower' });
    expect(designDirection({ ...EMPTY_DESIGN, renderMode: 'layered', logoPosition: 'top-right' }, 'IMAGE_FEED')).not.toHaveProperty('logoPosition');
  });
});
