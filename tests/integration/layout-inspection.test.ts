import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { generateAdvertisement } from '@/lib/pipeline/generate';
import { setAiProviderOverride } from '@/lib/ai';
import type { BriefRequest } from '@/lib/ai/types';
import { captureQueues, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });

/** the first drawn poster has icons in the reserved bottom zone; the re-draw is clean */
class Inspector extends FakeAiProvider {
  copy = ''; prompts: string[] = []; inspections = 0;
  async generateBrief(req: BriefRequest) { const r = await super.generateBrief(req); this.copy = [r.brief.headline, r.brief.badge, r.brief.supportingCopy ?? ''].filter(Boolean).join('\n'); return r; }
  async generateScene(prompt: string, opts: Parameters<FakeAiProvider['generateScene']>[1]) { this.prompts.push(prompt); return super.generateScene(prompt, opts); }
  async inspectPoster() {
    this.inspections++;
    const clean = this.prompts.length >= 2;
    return { text: this.copy, layout: { productVisible: true, bottomClear: clean, issues: clean ? [] : ['feature icons drawn in the bottom zone'] }, usage: { inputTokens: 900, outputTokens: 120 }, model: 'fake-vision' };
  }
}

describe('vision layout inspection of full-AI posters', () => {
  it('objects in the CTA zone trigger a LAYOUT CORRECTION re-draw; the clean poster is kept (no text fallback)', async () => {
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
    const p = new Inspector(); setAiProviderOverride(p);
    const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_STORY', direction: { renderMode: 'ai_full', idea: 'كوب شكر للمعلمة' } });
    expect(p.prompts).toHaveLength(2);
    expect(p.prompts[1]).toMatch(/LAYOUT CORRECTION[\s\S]*feature icons drawn in the bottom zone[\s\S]*bottom \d+%/);
    expect(p.prompts[1]).not.toMatch(/SPELLING CORRECTION/); // text was fine
    const ad = await prisma.advertisement.findUniqueOrThrow({ where: { id: r.advertisement.id } });
    expect(ad.templateKey).toBe('ai-poster');
    expect((ad.options as { aiTextCheck: { passed: boolean } }).aiTextCheck.passed).toBe(true);
    const qc = ad.qcReport as unknown as { checks: { id: string; passed: boolean }[] };
    expect(qc.checks.find((c) => c.id === 'ai_layout')?.passed).toBe(true);
  });
});
