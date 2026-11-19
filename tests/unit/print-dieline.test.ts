import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizePath, parseDieline, movePath } from '@/lib/print/dieline';
import { BriefSchema, analyze } from '@/lib/print/brief';
import { buildConcepts, bestConcept } from '@/lib/print/concepts';
import { renderDesign } from '@/lib/print/render';
import { runPrintQa } from '@/lib/print/qa';
import { pathToPdf } from '@/lib/print/pdf';

const cap = { disabledProducts: [] as string[], disabledMaterials: [] as string[], disabledFinishes: [] as string[], disabledMethods: [] as string[], pdfx: 'none' as const, iccProfile: '' };
const svg = readFileSync('tests/fixtures/tuck-box-dieline.svg', 'utf8');

describe('PRINT DESIGN STUDIO — supplier dieline (SVG)', () => {
  it('classifies cut / crease / glue by layer, size in mm, panels between creases inside the knife line', () => {
    const d = parseDieline(svg);
    expect(d.wMm).toBe(215); expect(d.hMm).toBe(200);
    expect(d.cut).toHaveLength(1); expect(d.fold).toHaveLength(6); expect(d.glue).toHaveLength(1);
    expect(d.panels[0]).toEqual({ x: 15, y: 40, w: 60, h: 120 });
    expect(d.panels.filter((p) => p.h === 120).map((p) => p.w).sort((a, b) => a - b)).toEqual([15, 40, 40, 60, 60]); // glue flap + 4 walls
    // a grid cell outside the knife line is not a panel
    expect(d.panels.some((p) => p.x === 15 && p.y === 0)).toBe(false);
    expect(d.warnings).toEqual([]);
  });
  it('reads colour / dash conventions without layer names, px units, relative and curved paths', () => {
    const d = parseDieline('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><path d="m10 10 h76 v76 h-76 z" stroke="#ff0000" fill="none"/><path d="M48 10 V86" stroke="#00ff00" stroke-dasharray="4 2"/><path d="M10 50 Q48 30 86 50" stroke="magenta" stroke-dasharray="1 1"/></svg>');
    expect(d.wMm).toBeCloseTo(76 * 25.4 / 96, 1); expect(d.fold).toHaveLength(1); expect(d.perf).toHaveLength(1);
    expect(d.perf[0]).toContain('C');
    expect(normalizePath('m0 0 l10 0 c0 5 5 5 5 0 s5 -5 10 0 z', 1, 0, 0)).toBe('M0 0 L10 0 C10 5 15 5 15 0 C15 -5 20 -5 25 0 Z');
    expect(movePath('M0 0 L10 0 Z', 3, 3)).toBe('M3 3 L13 3 Z');
    expect(pathToPdf('M0 0 C1 1 2 2 3 3', 10)).toMatch(/ c$/);
  });
  it('refuses files that are not usable dielines (no knife line, scripts, not SVG)', () => {
    expect(() => parseDieline('hello')).toThrow(/SVG/);
    expect(() => parseDieline('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>')).toThrow(/سكربت/);
    expect(() => parseDieline('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10mm"><line x1="0" y1="0" x2="5" y2="5" stroke="#00ff00" stroke-dasharray="1"/></svg>')).toThrow(/قص/);
  });
  it('with a dieline the box is designed flat on it: production is no longer blocked, art inside cut + bleed, creases as vectors', async () => {
    const dieline = parseDieline(svg);
    const b = BriefSchema.parse({ productId: 'perfume_box', activity: 'متجر عطور', business: 'Oud House', dieline, texts: { headline: 'عود ملكي', subline: 'عطر فاخر 50 مل', phone: '3600 1234' } });
    const a = analyze(b, cap);
    expect(a.blockers).toEqual([]); expect(a.trim).toEqual({ w: 215, h: 200 });
    const pages = await renderDesign({ a, b, concept: bestConcept(buildConcepts(a, a.product.finishes)), dpi: 60 });
    const p = pages[0];
    expect(p.foldPaths).toHaveLength(6); expect(p.cut).toMatch(/^M/); expect(p.frontRect).toBeTruthy(); expect(p.hidden?.[0].label).toContain('لصق');
    const head = p.placed.find((x) => x.id === 'headline')!;
    const fr = p.frontRect!;
    expect(head.rect.x).toBeGreaterThanOrEqual(fr.x); expect(head.rect.x + head.rect.w).toBeLessThanOrEqual(fr.x + fr.w);
    const qa = runPrintQa(a, b, pages);
    for (const id of ['safe_area', 'min_size', 'overflow', 'overlap']) expect(qa.checks.find((x) => x.id === id)?.status, id).toBe('PASS');
    expect(qa.checks.some((x) => x.status === 'BLOCKED')).toBe(false);
  });
});
