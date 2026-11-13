import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { updateSettings } from '@/lib/settings';
import { generateAdvertisement } from '@/lib/pipeline/generate';
import { setAiProviderOverride } from '@/lib/ai';
import { aiTextCheck } from '@/lib/qc';
import type { BriefRequest } from '@/lib/ai/types';
import { captureQueues, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });

/** draws wrong text until the `goodFrom`-th image; the reader reports what was "drawn" */
class Speller extends FakeAiProvider {
  copy: string[] = []; reads = 0; prompts: string[] = []; goodFrom = 3;
  async generateBrief(req: BriefRequest) { const r = await super.generateBrief(req); this.copy = [r.brief.headline, r.brief.badge, r.brief.supportingCopy ?? ''].filter(Boolean); return r; }
  async generateScene(prompt: string, opts: Parameters<FakeAiProvider['generateScene']>[1]) { this.prompts.push(prompt); return super.generateScene(prompt, opts); }
  async readText() { this.reads++; const good = this.prompts.length >= this.goodFrom; return { text: good ? this.copy.join('\n') : 'طباعه جمیع انواع [?]', usage: { inputTokens: 300, outputTokens: 40 }, model: 'fake-vision' }; }
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
  it('stops at the retry limit, reports what was wrong, and ships system-typeset text instead (STEP 07)', async () => {
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
    const p = new Speller(); p.goodFrom = 99; setAiProviderOverride(p);
    await updateSettings((s) => ({ ...s, ai: { ...s.ai, aiFullTextRetries: 1 } }));
    const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_STORY', direction: { renderMode: 'ai_full' } });
    expect(p.prompts).toHaveLength(3); // poster + 1 correction + the clean scene for verified typeset text
    const ad = await prisma.advertisement.findUniqueOrThrow({ where: { id: r.advertisement.id }, include: { approvals: true } });
    expect((ad.options as { aiTextCheck: { passed: boolean; missing: string[] } }).aiTextCheck.passed).toBe(false);
    expect((ad.options as { verifiedTextFallback?: boolean }).verifiedTextFallback).toBe(true);
    expect(ad.templateKey).not.toBe('ai-poster');
    expect(ad.approvals).toHaveLength(1); // never auto-published
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
