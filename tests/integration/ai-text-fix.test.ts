import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { updateSettings } from '@/lib/settings';
import { generateAdvertisement } from '@/lib/pipeline/generate';
import { setAiProviderOverride } from '@/lib/ai';
import { aiTextCheck } from '@/lib/qc';
import type { BriefRequest } from '@/lib/ai/types';
import { captureQueues, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });

/** the benefit labels a full-AI prompt asks the model to draw (a real model draws them; the fake reader reports them) */
const askedBenefits = (prompt: string) => { const m = /short benefits[^\n]*?: (.*)$/m.exec(prompt); return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : []; };
/** draws wrong text until the `goodFrom`-th image; the reader reports what was "drawn" */
class Speller extends FakeAiProvider {
  copy: string[] = []; reads = 0; prompts: string[] = []; goodFrom = 3;
  async generateBrief(req: BriefRequest) { const r = await super.generateBrief(req); this.copy = [r.brief.headline, r.brief.badge, r.brief.supportingCopy ?? ''].filter(Boolean); return r; }
  async generateScene(prompt: string, opts: Parameters<FakeAiProvider['generateScene']>[1]) { this.prompts.push(prompt); return super.generateScene(prompt, opts); }
  async readText() { this.reads++; const good = this.prompts.length >= this.goodFrom; return { text: good ? [...this.copy, ...askedBenefits(this.prompts[this.prompts.length - 1] ?? '')].join('\n') : 'طباعه جمیع انواع [?]', usage: { inputTokens: 300, outputTokens: 40 }, model: 'fake-vision' }; }
}

describe('self-correcting full-AI poster', () => {
  it('re-draws with an exact spelling correction until the machine-read text matches', async () => {
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
    const p = new Speller(); setAiProviderOverride(p);
    const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_STORY', direction: { renderMode: 'ai_full' } });
    expect(p.prompts).toHaveLength(3); // first draw + 2 corrections
    expect(p.prompts[1]).toMatch(/SPELLING CORRECTION \(attempt 2\)/);
    expect(p.prompts[1]).toContain(`«${p.copy[0]}»`);
    const ad = await prisma.advertisement.findUniqueOrThrow({ where: { id: r.advertisement.id } });
    expect((ad.options as { aiTextCheck: unknown }).aiTextCheck).toMatchObject({ attempts: 3, passed: true, missing: [] });
  });
  it('stops at the retry limit and keeps the best AI-designed poster (no fixed template), held for the owner with the wrong words', async () => {
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
    const p = new Speller(); p.goodFrom = 99; setAiProviderOverride(p);
    await updateSettings((s) => ({ ...s, ai: { ...s.ai, aiFullTextRetries: 1 } })); // default aiTextFallback = 'review'
    const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_STORY', direction: { renderMode: 'ai_full' } });
    expect(p.prompts).toHaveLength(2); // poster + 1 correction — no extra scene for a template
    const ad = await prisma.advertisement.findUniqueOrThrow({ where: { id: r.advertisement.id }, include: { approvals: true } });
    const check = (ad.options as { aiTextCheck: { passed: boolean; missing: string[] } }).aiTextCheck;
    expect(check.passed).toBe(false);
    expect(check.missing.length).toBeGreaterThan(0); // the wrong words are shown to the owner
    expect((ad.options as { verifiedTextFallback?: boolean }).verifiedTextFallback).toBeUndefined();
    expect(ad.templateKey).toBe('ai-poster'); // the layout stays designed for the idea
    expect(ad.state).not.toBe('PUBLISHED');
    expect(ad.approvals).toHaveLength(1); // never auto-published
  });
  it('with «template» chosen in the settings: ships system-typeset text in a layered template instead (STEP 07)', async () => {
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
    const p = new Speller(); p.goodFrom = 99; setAiProviderOverride(p);
    await updateSettings((s) => ({ ...s, ai: { ...s.ai, aiFullTextRetries: 1, aiTextFallback: 'template' } }));
    const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_STORY', direction: { renderMode: 'ai_full' } });
    expect(p.prompts).toHaveLength(3); // poster + 1 correction + the clean scene for verified typeset text
    const ad = await prisma.advertisement.findUniqueOrThrow({ where: { id: r.advertisement.id }, include: { approvals: true } });
    expect((ad.options as { aiTextCheck: { passed: boolean; missing: string[] } }).aiTextCheck.passed).toBe(false);
    expect((ad.options as { verifiedTextFallback?: boolean }).verifiedTextFallback).toBe(true);
    expect(ad.templateKey).not.toBe('ai-poster');
    expect(ad.approvals).toHaveLength(1); // never auto-published
  });
  it('brand features: woven into the AI design by default (spell-checked), a fixed system row only when chosen, or none', async () => {
    for (const mode of ['ai', 'system', 'off'] as const) {
      await resetDb(); captureQueues();
      const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false, featuresRow: mode } }) });
      const p = new Speller(); p.goodFrom = 1; setAiProviderOverride(p);
      const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_FEED', direction: { renderMode: 'ai_full' } });
      const ad = await prisma.advertisement.findUniqueOrThrow({ where: { id: r.advertisement.id } });
      const rows = (ad.layerManifest as { layers: { id: string }[] }).layers.filter((l) => l.id.startsWith('benefit:'));
      const asked = askedBenefits(p.prompts[0]);
      if (mode === 'ai') { expect(asked.length).toBeGreaterThan(0); expect(rows).toHaveLength(0); expect((ad.options as { aiTextCheck: { passed: boolean } }).aiTextCheck.passed).toBe(true); }
      if (mode === 'system') { expect(asked).toHaveLength(0); expect(rows.length).toBeGreaterThan(0); }
      if (mode === 'off') { expect(asked).toHaveLength(0); expect(rows).toHaveLength(0); }
    }
  });
  it('layered designs are not affected', async () => {
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
    const p = new Speller(); setAiProviderOverride(p);
    await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_FEED', direction: { renderMode: 'layered' } });
    expect(p.prompts).toHaveLength(1);
    expect(p.reads).toBe(0);
  });
  it('text check: exact, missing, illegible', () => {
    expect(aiTextCheck(['طباعة', 'الأكواب'], 'طباعة\nالأكواب')).toMatchObject({ ok: true });
    expect(aiTextCheck(['طباعة', 'الأكواب'], 'طباعة')).toMatchObject({ ok: false, missing: ['الأكواب'] });
    expect(aiTextCheck(['طباعة'], 'طباعة [?]')).toMatchObject({ ok: false, garbled: 1 });
    expect(aiTextCheck(['طباعة'], null).ok).toBe(false);
  });
});
