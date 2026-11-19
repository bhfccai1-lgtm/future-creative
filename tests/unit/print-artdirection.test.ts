import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { artPlan, extendToRatio } from '@/lib/print/artdirection';
import { BriefSchema, analyze } from '@/lib/print/brief';
import { buildConcepts, bestConcept } from '@/lib/print/concepts';

const cap = { disabledProducts: [] as string[], disabledMaterials: [] as string[], disabledFinishes: [] as string[], disabledMethods: [] as string[], pdfx: 'none' as const, iccProfile: '' };
const plan = (productId: string, box: { w: number; h: number }, extra: Record<string, unknown> = {}) => {
  const b = BriefSchema.parse({ productId, activity: 'مقهى قهوة', business: 'Bean', texts: { headline: 'قهوة مختصة' }, ...extra });
  const a = analyze(b, cap); return artPlan(a, b, bestConcept(buildConcepts(a, a.product.finishes)), box);
};

describe('PRINT DESIGN STUDIO — art direction per size', () => {
  it('chooses the closest model canvas, tells the crop, and extends extreme proportions', () => {
    const rollup = plan('rollup', { w: 790, h: 1232 });
    expect(rollup.size).toBe('1024x1536'); expect(rollup.extend).toBe('none'); expect(rollup.quality).toBe('high');
    expect(rollup.prompt).toContain('several metres'); expect(rollup.prompt).toMatch(/NO text/);
    const banner = plan('pvc_banner', { w: 2900, h: 600 });
    expect(banner.size).toBe('1536x1024'); expect(banner.extend).toBe('horizontal'); expect(banner.prompt).toContain('extended sideways');
    const square = plan('flyer', { w: 120, h: 118 }, { sizeId: 'A5' });
    expect(square.size).toBe('1024x1024'); expect(square.extend).toBe('none');
    const mugBox = plan('mug', { w: 90, h: 75 });
    expect(mugBox.keepH).toBeLessThan(100); expect(mugBox.prompt).toContain('central');
  });
  it('cut-out products get a transparent background and an isolated-subject style', () => {
    const s = plan('diecut_sticker', { w: 60, h: 40 });
    expect(s.background).toBe('transparent'); expect(s.prompt).toContain('die-cut'); expect(s.prompt).toContain('Transparent background');
    const t = plan('tshirt', { w: 250, h: 300 });
    expect(t.background).toBe('transparent'); expect(t.prompt).toContain('T-shirt print');
    expect(plan('flyer', { w: 120, h: 80 }).background).toBe('opaque');
  });
  it('quality follows the print area and premium finishes', () => {
    expect(plan('flyer', { w: 50, h: 40 }).quality).toBe('low');
    expect(plan('flyer', { w: 140, h: 100 }).quality).toBe('medium');
    expect(plan('flyer', { w: 140, h: 100 }, { activity: 'متجر عطور' }).quality).toBe('high');
  });
  it('background extension keeps the original pixels in the middle and reaches the exact proportion', async () => {
    const src = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#2255aa' } }).composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><circle cx="150" cy="100" r="60" fill="#ffcc00"/></svg>') }]).png().toBuffer();
    const out = await extendToRatio(src, 3);
    const m = await sharp(out).metadata(); expect(m.width).toBe(600); expect(m.height).toBe(200);
    const centre = await sharp(out).extract({ left: 300, top: 100, width: 1, height: 1 }).raw().toBuffer();
    expect(centre[0]).toBeGreaterThan(240); expect(centre[1]).toBeGreaterThan(190); // the yellow subject is intact
    const tall = await sharp(await extendToRatio(src, 0.5)).metadata(); expect(tall.width).toBe(300); expect(tall.height).toBe(600);
  });
});
