import { describe, expect, it } from 'vitest';
import { pickFormat, normaliseMix, DEFAULT_MIX } from '@/lib/creative/format-mix';

describe('growth content mix', () => {
  it('starts with a Reel and converges to the 60/30/10 target', () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 20; i++) { const f = pickFormat(DEFAULT_MIX, counts); counts[f] = (counts[f] ?? 0) + 1; if (i === 0) expect(f).toBe('REEL_VIDEO'); }
    expect(counts).toEqual({ REEL_VIDEO: 12, IMAGE_FEED: 6, IMAGE_STORY: 2 });
  });
  it('fills the biggest gap first', () => {
    expect(pickFormat(DEFAULT_MIX, { REEL_VIDEO: 5, IMAGE_FEED: 0, IMAGE_STORY: 0 })).toBe('IMAGE_FEED');
  });
  it('invalid or empty mixes fall back to the default', () => {
    expect(normaliseMix(null)).toEqual(DEFAULT_MIX);
    expect(normaliseMix({ VIDEO: 5, REEL_VIDEO: -1 })).toEqual(DEFAULT_MIX);
    expect(normaliseMix({ IMAGE_FEED: 1 })).toEqual({ IMAGE_FEED: 1 });
  });
});
