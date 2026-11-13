import { beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { prisma } from '@/lib/db';
import { generateAdvertisement } from '@/lib/pipeline/generate';
import { setAiProviderOverride } from '@/lib/ai';
import { storage } from '@/lib/storage';
import type { BriefRequest } from '@/lib/ai/types';
import { captureQueues, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });

/** image model double whose drawn text the reader sees as correct (`good`) or misspelled (`bad`) */
class Studio extends FakeAiProvider {
  copy: string[] = []; constructor(private good: boolean) { super(); }
  async generateBrief(req: BriefRequest) { const r = await super.generateBrief(req); this.copy = [r.brief.headline, r.brief.badge, r.brief.supportingCopy ?? ''].filter(Boolean); return r; }
  async readText() { return { text: this.good ? this.copy.join('\n') : 'طباعه جمیع انواع [?]', usage: { inputTokens: 300, outputTokens: 40 }, model: 'fake-vision' }; }
}
const OUT = process.env.V6_OUT_DIR;
type Qc = { checks: { id: string; passed: boolean }[]; requiresHuman?: boolean };

async function run(slug: string, good: boolean) {
  const { accounts } = await seedBase({ productCount: 100, settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
  const product = await prisma.product.findUniqueOrThrow({ where: { slug } });
  setAiProviderOverride(new Studio(good));
  const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 'v6-test', productId: product.id, format: 'IMAGE_STORY', direction: { renderMode: 'ai_full' } });
  const ad = await prisma.advertisement.findUniqueOrThrow({ where: { id: r.advertisement.id }, include: { media: true } });
  const fin = ad.media.find((m) => m.role === 'FINAL')!;
  const png = await storage().get(fin.storageKey.replace(/final\.jpg$/, 'final.png'));
  if (OUT) { await mkdir(OUT, { recursive: true }); await writeFile(`${OUT}/${slug}-${good ? 'ai-text' : 'verified-fallback'}.png`, png); }
  return { ad, png, qc: ad.qcReport as unknown as Qc, o: ad.options as Record<string, unknown> };
}

describe('V6 production pipeline — custom printed mug & roll-up banner', () => {
  for (const slug of ['ceramic-mugs', 'roll-up-banners']) {
    it(`${slug}: 3 concepts → rubric pick → full poster → brand layers → QA → pending human review (PNG 1080×1920)`, async () => {
      const { ad, png, qc, o } = await run(slug, true);
      const sel = o.conceptSelection as { chosen: string; candidates: { total: number }[] };
      expect(sel.candidates).toHaveLength(3); // STEP 02
      expect(sel.candidates[0].total).toBeGreaterThanOrEqual(sel.candidates[2].total);
      expect(ad.templateKey).toBe('ai-poster');
      const m = await sharp(png).metadata();
      expect([m.format, m.width, m.height]).toEqual(['png', 1080, 1920]); // STEP 08
      const manifest = ad.layerManifest as { layers: { id: string; text?: string }[] };
      expect(manifest.layers.find((l) => l.id === 'contact:saar:phone')?.text).toBe('33316319'); // STEP 05
      expect(manifest.layers.find((l) => l.id === 'contact:salmabad:phone')?.text).toBe('34315316');
      expect(manifest.layers.some((l) => l.id === 'logo')).toBe(true);
      expect(ad.logoSha256).toBeTruthy();
      const failed = qc.checks.filter((c) => !c.passed).map((c) => c.id);
      console.log(`[v6] ${slug}: state=${ad.state} qcPassed=${ad.qcPassed} failed=${JSON.stringify(qc.checks.filter((c) => !c.passed))} chosen=«${sel.chosen}»`);
      expect(ad.state).not.toBe('PUBLISHED'); // STEP 09: never auto-published here
      expect((o.aiTextCheck as { passed: boolean }).passed).toBe(true);
    });
  }

  it('drawn Arabic text that never verifies is NOT shipped: re-rendered with system-typeset text (STEP 07)', async () => {
    const { ad, o, png } = await run('ceramic-mugs', false);
    expect(o.verifiedTextFallback).toBe(true);
    expect(ad.templateKey).not.toBe('ai-poster');
    const manifest = ad.layerManifest as { layers: { id: string; text?: string }[] };
    expect(manifest.layers.find((l) => l.id === 'headline')?.text).toBeTruthy(); // typeset by the system, verifiable
    expect((await sharp(png).metadata()).height).toBe(1920);
    console.log(`[v6] fallback: template=${ad.templateKey} qcPassed=${ad.qcPassed}`);
  });
});
