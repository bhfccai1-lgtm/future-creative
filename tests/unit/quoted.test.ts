import { describe, expect, it } from 'vitest';
import { quotedPhrases } from '@/lib/pipeline/generate';
import { fullPosterPrompt } from '@/lib/ai/prompts';

describe('quoted phrases from the owner idea', () => {
  it('extracts «…» and "…" phrases exactly, at most two', () => {
    expect(quotedPhrases('كوب عليه العبارة: «إذا ما صحّتني القهوة… اعتبرني في وضع الطيران!». إضاءة دافئة')).toEqual(['إذا ما صحّتني القهوة… اعتبرني في وضع الطيران!']);
    expect(quotedPhrases('mug "Best Dad" and “Love you” and «ثالث»')).toEqual(['Best Dad', 'Love you']);
    expect(quotedPhrases('بدون اقتباس')).toEqual([]);
    expect(quotedPhrases(undefined)).toEqual([]);
  });
  it('the full-AI poster prompt asks to print the phrase on the product', () => {
    const p = fullPosterPrompt({ lang: 'ar', headline: 'طباعة الأكواب', badge: 'حسب الطلب', features: [], sceneDescription: 'mug', style: 's', productText: ['اعتبرني في وضع الطيران!'] });
    expect(p).toContain('printed ON the product itself');
    expect(p).toContain('"اعتبرني في وضع الطيران!"');
  });
});
