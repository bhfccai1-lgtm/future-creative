import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { generateAdvertisement } from '@/lib/pipeline/generate';
import { setAiProviderOverride } from '@/lib/ai';
import { normalizeBrief } from '@/lib/ai/brief-normalize';
import type { VoiceoverRequest } from '@/lib/ai/types';
import { captureQueues, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });

class Rec extends FakeAiProvider {
  prompts: string[] = []; vo: VoiceoverRequest[] = [];
  async generateScene(prompt: string, opts: Parameters<FakeAiProvider['generateScene']>[1]) { this.prompts.push(prompt); return super.generateScene(prompt, opts); }
  async writeVoiceover(req: VoiceoverRequest) { this.vo.push(req); return { script: 'شفت شلون؟ كوبك بتصميمك، اطلبه الحين', usage: { inputTokens: 10, outputTokens: 10 }, model: 'fake' }; }
}

describe('reel storyboard', () => {
  it('pro reel shots follow the idea\'s own story (hook → context → product → benefit) and the voice-over follows the same shots', async () => {
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
    const p = new Rec(); setAiProviderOverride(p);
    const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'REEL_VIDEO', direction: { reelStyle: 'pro', reelDuration: 20, audio: 'voiceover' } });
    const brief = await prisma.creativeBrief.findFirstOrThrow({ where: { id: r.advertisement.briefId! } });
    const story = (brief.rawJson as { storyboard: { beat: string; scene: string }[] }).storyboard;
    expect(story.map((x) => x.beat)).toEqual(['hook', 'context', 'product', 'benefit']);
    expect(p.prompts).toHaveLength(3); // 20 s → 3 scenes: hero + 2 storyboard shots
    expect(p.prompts[1]).toContain(story[1].scene);
    expect(p.prompts[2]).toContain(story[2].scene);
    expect(p.prompts[1]).toMatch(/Same product as the first shot/);
    expect(p.vo[0].storyboard).toHaveLength(4);
    expect(p.vo[0].storyboard![0]).toMatch(/^hook: /);
  });
  it('normalizer drops invalid beats and caps the story', () => {
    const { brief } = normalizeBrief({ storyboard: [{ beat: 'hook', scene: 'a' }, { beat: 'nope', scene: 'b' }, { beat: 'product', scene: '' }, { beat: 'context', scene: 'c' }, { beat: 'benefit', scene: 'd' }, { beat: 'product', scene: 'e' }, { beat: 'hook', scene: 'f' }] }, 'اطلب الآن');
    expect((brief as { storyboard: { beat: string }[] }).storyboard.map((x) => x.beat)).toEqual(['hook', 'context', 'benefit', 'product']);
  });
});
