import { describe, expect, it } from 'vitest';
import { FORMAT_SIZE, TEMPLATES, productZone, templateFor } from '@/lib/render/templates';
import { scenePrompt } from '@/lib/ai/prompts';

/** scene fraction (2:3 image, cover-fitted and centred) → canvas fraction */
const toCanvas = (f: number, W: number, H: number) => { const sc = Math.max(W / 1024, H / 1536), sh = 1536 * sc, off = (sh - H) / 2; return (f * sh - off) / H; };

describe('the product stands where no text covers it', () => {
  it('for every template and format, the product zone never meets the headline, support line, logo, CTA panel or the dark text shade', () => {
    for (const t of TEMPLATES) for (const fmt of ['IMAGE_FEED', 'IMAGE_SQUARE', 'IMAGE_CAROUSEL'] as const) {
      const { w, h } = FORMAT_SIZE[fmt];
      const z = productZone(t.key, w, h)!;
      expect(z.bottom - z.top).toBeGreaterThan(0.2); // still room for a large product
      const [top, bottom] = [toCanvas(z.top, w, h), toCanvas(z.bottom, w, h)];
      const L = templateFor(t.key, h);
      const blocks = [L.logo, L.headline, L.support].map((b) => [b.y, b.y + b.h]);
      blocks.push([L.panel.y, 1]);
      for (const s of L.shade.filter((x) => x.dir === 'up')) blocks.push([s.from, s.to]);
      for (const [a, b] of blocks) expect(bottom <= a + 1e-6 || top >= b - 1e-6, `${t.key} ${fmt}: product ${top.toFixed(2)}–${bottom.toFixed(2)} meets ${a.toFixed(2)}–${b.toFixed(2)}`).toBe(true);
    }
  });

  it('the «gold frame, lower headline» template gets the product in the upper half; the classic one below its top headline', () => {
    const lower = productZone('gold-frame-lower', 1080, 1350)!, classic = productZone('navy-gold-classic', 1080, 1350)!;
    expect(lower.bottom).toBeLessThan(0.5);
    expect(classic.top).toBeGreaterThan(0.3);
    expect(productZone('gold-poster', 1080, 1920)).toBeNull(); // own composition rules
    expect(productZone('ai-poster', 1080, 1350)).toBeNull();
    expect(productZone('gold-frame-lower', 1080, 1920)).toBeNull(); // vertical: centred composition kept
  });

  it('the scene prompt states the zone instead of «centred» when the layout is known', () => {
    const p = scenePrompt('a printed mug', 'luxury', undefined, { top: 0.2, bottom: 0.48 });
    expect(p).toMatch(/between 20% and 48% of the image height/);
    expect(p).not.toMatch(/between 39% and 64%/);
    expect(scenePrompt('a printed mug', 'luxury')).toMatch(/between 39% and 64%/); // unchanged without a zone
  });
});
