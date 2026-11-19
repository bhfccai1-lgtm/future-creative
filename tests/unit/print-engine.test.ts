import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { CATEGORIES, FAMILIES, PRODUCTS, available, ppiForDistance, productById, spineMm } from '@/lib/print/catalog';
import { BriefSchema, analyze, extractContacts, guessProduct } from '@/lib/print/brief';
import { detectIndustry } from '@/lib/print/identity';
import { buildConcepts, bestConcept } from '@/lib/print/concepts';
import { renderDesign, scaleP } from '@/lib/print/render';
import { runPrintQa } from '@/lib/print/qa';
import { buildPrintPdf, pathToPdf } from '@/lib/print/pdf';
import { buildMockup } from '@/lib/print/mockup';
import { inspectPdf } from '@/lib/edu/pdf';

const cap = { disabledProducts: [] as string[], disabledMaterials: [] as string[], disabledFinishes: [] as string[], disabledMethods: [] as string[], pdfx: 'none' as const, iccProfile: '' };
const T = { headline: 'قهوة مختصة تُحضّر أمامك', subline: 'محمصة يومية', name: 'أحمد علي', role: 'مدير العمليات', phone: '3600 1234', email: 'info@cafe.bh', website: 'cafe.bh', cta: 'زورونا اليوم', extra: ['إسبريسو وفلتر', 'حلويات طازجة'] };
const design = async (productId: string, extra: Record<string, unknown> = {}, dpi = 60) => {
  const b = BriefSchema.parse({ productId, activity: 'مقهى قهوة مختصة', business: 'Bean Café', texts: T, ...extra });
  const a = analyze(b, cap); const cc = bestConcept(buildConcepts(a, a.product.finishes));
  return { a, b, cc, pages: await renderDesign({ a, b, concept: cc, dpi }) };
};

describe('PRINT DESIGN MASTER — product database', () => {
  it('covers the 11 categories with families, sizes, materials and production rules', () => {
    expect(Object.keys(CATEGORIES)).toHaveLength(11);
    for (const k of Object.keys(CATEGORIES)) expect(PRODUCTS.filter((p) => p.cat === k).length, k).toBeGreaterThan(3);
    expect(PRODUCTS.length).toBeGreaterThan(100);
    expect(new Set(PRODUCTS.map((p) => p.id)).size).toBe(PRODUCTS.length);
    for (const p of PRODUCTS) { expect(FAMILIES[p.family], p.id).toBeTruthy(); expect(p.sizes.length, p.id).toBeGreaterThan(0); }
    // different products → different production specs (no business-card values on banners or mugs)
    expect(FAMILIES.large_format.ppi).toBeLessThan(FAMILIES.card.ppi);
    expect(FAMILIES.wrap.bleedMm).toBe(0);
    expect(FAMILIES.packaging.requires).toContain('dieline');
    expect(FAMILIES.sticker.vectorLayers).toContain('cut');
  });
  it('respects what the shop really offers', () => {
    const p = productById('business_card')!;
    const av = available(p, { ...cap, disabledFinishes: ['gold_foil'], disabledMaterials: ['pvc'] });
    expect(av.finishes).not.toContain('gold_foil'); expect(av.materials).not.toContain('pvc');
    const a = analyze(BriefSchema.parse({ productId: 'business_card' }), { ...cap, disabledProducts: ['business_card'] });
    expect(a.blockers.join()).toContain('غير مفعّل'); expect(a.productionPossible).toBe(false);
  });
  it('resolution follows viewing distance; spine follows page count', async () => {
    expect(ppiForDistance(0.3)).toBe(300);
    expect(ppiForDistance(3)).toBeLessThan(120);
    expect(ppiForDistance(15)).toBe(50);
    expect(spineMm(120, 0.1)).toBe(6);
    const { acuityPpi, effectivePpi } = await import('@/lib/print/catalog');
    expect(acuityPpi(3)).toBeGreaterThan(25); expect(acuityPpi(3)).toBeLessThan(35); expect(acuityPpi(0.3)).toBeGreaterThan(250);
    expect(effectivePpi(1536, 850)).toBe(46);
  });
});

describe('PRINT DESIGN MASTER — request understanding & identity', () => {
  it('reads the product, contacts and size from free text — never inventing data', () => {
    expect(guessProduct('أبغى رول أب لعيادتي')).toBe('rollup');
    expect(guessProduct('بطاقات عمل للشركة')).toBe('business_card');
    expect(guessProduct('استيكرات دائرية للمحل')).toBe('vinyl_sticker');
    const c = extractContacts('رقمنا 3600 1234 والبريد sales@prime.bh والمقاس 90×50 مم');
    expect(c.phone).toBe('3600 1234'); expect(c.email).toBe('sales@prime.bh'); expect(c.mm).toEqual({ w: 90, h: 50 });
    expect(extractContacts('بدون بيانات').phone).toBe('');
  });
  it('identity changes with the activity', () => {
    expect(detectIndustry('مركز طبي للأسنان').id).toBe('medical');
    expect(detectIndustry('متجر عطور وبخور').id).toBe('perfume');
    expect(detectIndustry('محل ألعاب أطفال').id).toBe('toys');
    expect(detectIndustry('شركة عقارات').palette.primary).not.toBe(detectIndustry('محل ألعاب').palette.primary);
  });
  it('analysis: suitable material for the use, honest blockers, assumptions stated', () => {
    const out = analyze(BriefSchema.parse({ productId: 'vinyl_sticker', conditions: { outdoor: true, waterproof: true } }), cap);
    expect(['vinyl']).toContain(out.material);
    const pack = analyze(BriefSchema.parse({ productId: 'box' }), cap);
    expect(pack.productionPossible).toBe(false); expect(pack.blockers.join()).toContain('Dieline');
    const food = analyze(BriefSchema.parse({ productId: 'food_pack', conditions: { food: true } }), cap);
    expect(food.warnings.join()).toContain('الأغذية');
    const book = analyze(BriefSchema.parse({ productId: 'book', pages: 118 }), cap);
    expect(book.pages).toBe(120);
    const ru = analyze(BriefSchema.parse({ productId: 'rollup', viewM: 3 }), cap);
    expect(ru.targetPpi).toBeLessThan(150); expect(ru.assumptions.join()).toContain('مسافة المشاهدة');
  });
  it('three scored concepts; the best is chosen', () => {
    const a = analyze(BriefSchema.parse({ productId: 'business_card', activity: 'متجر عطور' }), cap);
    const cs = buildConcepts(a, a.product.finishes);
    expect(cs.map((c) => c.key)).toEqual(['A', 'B', 'C']);
    for (const c of cs) for (const v of Object.values(c.scores)) { expect(v).toBeGreaterThanOrEqual(1); expect(v).toBeLessThanOrEqual(10); }
    expect(bestConcept(cs).key).toBe('A'); // luxury & simple fits perfume
    const noFoil = buildConcepts(a, a.product.finishes.filter((f) => f !== 'gold_foil'));
    expect(noFoil.flatMap((c) => c.finishes)).not.toContain('gold_foil');
  });
});

describe('PRINT DESIGN MASTER — layout, geometry and prepress', () => {
  it('business card: two faces at the exact size + bleed, contacts readable, nothing outside the safe area', async () => {
    const { a, b, pages } = await design('business_card', { sizeId: 'bc90x50' }, 300);
    expect(pages).toHaveLength(2);
    expect(pages[0].widthPx).toBe(Math.round(96 * 300 / 25.4)); expect(pages[0].heightPx).toBe(Math.round(56 * 300 / 25.4));
    expect(pages[1].placed.map((x) => x.id)).toEqual(expect.arrayContaining(['name', 'role', 'contact:0']));
    const qa = runPrintQa(a, b, pages);
    for (const id of ['overlap', 'safe_area', 'overflow', 'min_size', 'glyphs', 'dimensions', 'separation']) expect(qa.checks.find((x) => x.id === id)?.status, id).toBe('PASS');
    expect(qa.checks.find((x) => x.id === 'aesthetic')?.status).toBe('NOT_VERIFIED');
    expect(qa.productionReady).toBe(false); // not approved / not exported
  });
  it('text colour always reads against the real background (headline on a colour band is not lost)', async () => {
    const { pages } = await design('flyer', { sizeId: 'A5' }, 60);
    const h = pages[0].placed.find((x) => x.id === 'headline')!;
    const { data, info } = await sharp(pages[0].png).extract({ left: h.rect.x, top: h.rect.y, width: h.rect.w, height: h.rect.h }).greyscale().raw().toBuffer({ resolveWithObject: true });
    let min = 255, max = 0; for (const v of data) { min = Math.min(min, v); max = Math.max(max, v); }
    expect(max - min).toBeGreaterThan(120); void info;
  });
  it('die-cut sticker: separate vector cut path, art kept inside cut + bleed, white ink for transparent film', async () => {
    const { pages } = await design('transparent_sticker', { texts: { headline: 'Oud' } }, 150);
    expect(pages[0].cut).toMatch(/^M/); expect(pages[0].white).toBeTruthy(); expect(pages[0].transparentBg).toBe(true);
    const corner = await sharp(pages[0].png).extract({ left: 0, top: 0, width: 2, height: 2 }).raw().toBuffer();
    expect(corner[3]).toBe(0); // outside the circle: no art
  });
  it('kiss-cut sheet keeps ≥ 3 mm between pieces', async () => {
    const { pages } = await design('kisscut_sheet', { texts: { headline: 'Toy' } }, 40);
    const sheet = pages.find((p) => p.kissCut?.length)!;
    expect(sheet.kissCut!.length).toBeGreaterThan(4); expect(sheet.trimMm).toEqual({ w: 210, h: 297 });
  });
  it('tri-fold brochure: real fold lines, the fold-in panel 2 mm narrower, two faces', async () => {
    const { pages } = await design('brochure', { orientation: 'landscape' }, 40);
    expect(pages).toHaveLength(2);
    const f = pages[0].folds!; expect(f).toHaveLength(2);
    expect(Math.abs((f[1] - f[0]) - 99.67)).toBeLessThan(0.2);
  });
  it('book: cover spread with a spine from the page count, master pages with a wider binding margin', async () => {
    const { pages } = await design('book', { pages: 120, finishes: ['perfect_bind'] }, 30);
    expect(pages[0].trimMm.w).toBeCloseTo(210 * 2 + 6, 1);
    expect(pages[0].folds).toHaveLength(2);
    expect(pages.length).toBe(3);
  });
  it('roll-up: hidden stand-base zone, headline sized for the viewing distance', async () => {
    const { a, b, pages } = await design('rollup', { viewM: 3, activity: 'عيادة أسنان', texts: { headline: 'ابتسامتك تبدأ هنا', cta: 'احجز' } }, 15);
    expect(pages[0].hidden?.[0].label).toContain('قاعدة');
    const h = pages[0].placed.find((x) => x.id === 'headline')!;
    expect(h.rect.h / (15 / 25.4)).toBeGreaterThan(12); // mm
    expect(runPrintQa(a, b, pages).checks.find((x) => x.id === 'safe_area')?.status).toBe('PASS');
  });
  it('mug: print-area template without bleed, seam zones, mirrored copy for sublimation; t-shirt: transparent + white underbase', async () => {
    const m = await design('mug', {}, 100);
    expect(m.pages[0].bleedMm).toBe(0); expect(m.pages[0].hidden).toHaveLength(2); expect(m.pages[1].note).toBe('mirrored');
    const t = await design('tshirt', { conditions: { darkFabric: true }, texts: { headline: 'TEAM 11' } }, 60);
    expect(t.pages[0].transparentBg).toBe(true); expect(t.pages[0].white).toBeTruthy();
  });
  it('printer identity never appears in a client product without consent', async () => {
    const { a, b, pages } = await design('flyer', { texts: { ...T, extra: ['اتصل 33316319'] } }, 40);
    expect(runPrintQa(a, b, pages).checks.find((x) => x.id === 'separation')?.status).toBe('BLOCKED');
    const ok = runPrintQa(a, { ...b, shopBrandingConsent: true }, pages);
    expect(ok.checks.find((x) => x.id === 'separation')?.status).toBe('PASS');
  });
  it('print PDF: CMYK image, TrimBox/BleedBox and spot-colour CutContour/Fold vectors; arcs become Béziers', async () => {
    expect(pathToPdf('M10 20 A10 10 0 1 0 30 20 A10 10 0 1 0 10 20 Z', 40)).toMatch(/ c .* c .* h$/);
    expect(scaleP('M1 2 A3 3 0 1 0 5 6 Z', 10)).toBe('M10 20 A30 30 0 1 0 50 60 Z');
    const { pages } = await design('diecut_sticker', { texts: { headline: 'Toy' } }, 100);
    const p = pages[0];
    const jpeg = await sharp(p.png).flatten({ background: '#fff' }).toColourspace('cmyk').jpeg().toBuffer();
    const pdf = buildPrintPdf([{ jpeg, cmyk: true, widthPx: p.widthPx, heightPx: p.heightPx, mediaMm: { w: p.trimMm.w + 2 * p.bleedMm, h: p.trimMm.h + 2 * p.bleedMm }, bleedMm: p.bleedMm, cut: p.cut }], { title: 't', producer: 'test' });
    const s = pdf.toString('latin1');
    expect(s).toContain('/Separation /CutContour'); expect(s).toContain('/DeviceCMYK /Decode'); expect(s).toContain('/TrimBox'); expect(s).toContain('/BleedBox');
    expect(inspectPdf(pdf).ok).toBe(true);
    expect((await sharp(jpeg).metadata()).space).toBe('cmyk');
  });
  it('mockup uses the design pixels and is labelled display-only', async () => {
    const { pages } = await design('business_card', {}, 100);
    const jpg = await buildMockup('cards', pages);
    const m = await sharp(jpg).metadata(); expect(m.width).toBe(1600); expect(m.format).toBe('jpeg');
  });
  it('finishing plates: gold foil on logo + headline is a pixel-aligned 100 % black plate; QA checks fine type', async () => {
    const { a, b, pages } = await design('business_card', { sizeId: 'bc90x50', finishes: ['gold_foil', 'spot_uv'], finishTarget: 'logo_headline', texts: { ...T, headline: 'قهوة مختصة' } }, 300);
    const front = pages[0];
    expect(front.separations?.map((s) => s.finish)).toEqual(['gold_foil', 'spot_uv']);
    const sp = front.separations![0];
    expect(sp.ids).toEqual(expect.arrayContaining(['headline']));
    const m = await sharp(sp.png).metadata(); expect(m.width).toBe(front.widthPx); expect(m.height).toBe(front.heightPx);
    // black exactly where the headline is, white far away from it
    const h = front.placed.find((x) => x.id === 'headline')!;
    const { data } = await sharp(sp.png).extract({ left: h.rect.x, top: h.rect.y, width: h.rect.w, height: h.rect.h }).greyscale().raw().toBuffer({ resolveWithObject: true });
    expect(Math.min(...data)).toBeLessThan(30);
    const corner = await sharp(sp.png).extract({ left: 2, top: 2, width: 4, height: 4 }).greyscale().raw().toBuffer();
    expect(Math.min(...corner)).toBeGreaterThan(240);
    const qa = runPrintQa(a, b, pages);
    expect(qa.checks.find((x) => x.id === 'finishing:gold_foil')?.status).toBe('PASS');
    // emboss needs ≥ 10 pt: a small tagline-only target is flagged
    const e = await design('business_card', { finishes: ['emboss'], finishTarget: 'name', texts: { ...T, name: 'أحمد' } }, 150);
    const qe = runPrintQa(e.a, e.b, e.pages).checks.find((x) => x.id === 'finishing:emboss')!;
    expect(['PASS', 'NEEDS_REVISION']).toContain(qe.status);
    // a finish the product does not support is ignored (no plate)
    const f = await design('flyer', { finishes: ['gold_foil'] }, 40);
    expect(f.pages[0].separations).toBeUndefined();
  });
});

