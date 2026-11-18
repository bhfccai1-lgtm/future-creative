import { describe, expect, it, vi } from 'vitest';
import { probeFreeLlmGeneration } from '@/lib/ai/freellm-check';

describe('FreeLLMAPI real generation probe', () => {
  it('accepts an actual, non-empty completion and reports the served model', async () => {
    const request = vi.fn(async () => ({ model: 'upstream-free-model', choices: [{ message: { content: '  OK  ' } }] }));
    await expect(probeFreeLlmGeneration(request)).resolves.toEqual({ servedModel: 'upstream-free-model' });
    expect(request).toHaveBeenCalledOnce();
  });

  it('rejects empty completions instead of incorrectly reporting a successful connection', async () => {
    await expect(probeFreeLlmGeneration(async () => ({ model: 'auto', choices: [{ message: { content: '   ' } }] })))
      .rejects.toThrow('FREELLM_EMPTY_COMPLETION');
    await expect(probeFreeLlmGeneration(async () => ({ model: 'auto', choices: [] })))
      .rejects.toThrow('FREELLM_EMPTY_COMPLETION');
  });

  it('propagates upstream errors instead of reporting a false success', async () => {
    await expect(probeFreeLlmGeneration(async () => { throw new Error('upstream unavailable'); }))
      .rejects.toThrow('upstream unavailable');
  });
});
