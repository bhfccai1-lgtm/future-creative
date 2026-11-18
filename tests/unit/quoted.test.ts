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

describe('foreign drawn text guard', () => {
  it('flags a slogan that is not part of the approved copy (leak from another ad)', async () => {
    const { aiTextCheck } = await import('@/lib/qc');
    const expected = ['كل تفصيلة تليق', 'باقة صالون', 'بتصميم خاص لك'];
    const allowed = ['تصاميم مخصصة', 'جودة طباعة عالية', 'مناسبات خاصة', 'هدايا الشركات'];
    const clean = aiTextCheck(expected, ['كل تفصيلة تليق', 'باقة صالون', 'بتصميم خاص لك', 'تصاميم مخصصة', 'هدايا الشركات'].join('\n'), allowed);
    expect(clean).toMatchObject({ ok: true, foreign: [] });
    const leak = aiTextCheck(expected, ['كل تفصيلة تليق', 'باقة صالون', 'بتصميم خاص لك', 'إذا ما صحتني القهوة… اعتبرني في وضع الطيران!'].join('\n'), allowed);
    expect(leak.ok).toBe(false);
    expect(leak.foreign[0]).toMatch(/القهوة/);
  });
});

describe('Google archive script generator', () => {
  it('reads ids from pasted links and fills them into the script (sheet auto-created)', async () => {
    const { googleIdFrom, appsScriptSource } = await import('@/lib/integrations/google-archive');
    expect(googleIdFrom('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv?usp=sharing', 'folder')).toBe('1AbCdEfGhIjKlMnOpQrStUv');
    expect(googleIdFrom('https://docs.google.com/spreadsheets/d/1ZyXwVuTsRqPoNmLkJiHgF/edit#gid=0', 'sheet')).toBe('1ZyXwVuTsRqPoNmLkJiHgF');
    expect(googleIdFrom('not a link', 'folder')).toBeNull();
    const src = appsScriptSource({ folderId: 'F1234567890abcdef', sheetId: 'S1234567890abcdef', host: 'example.sslip.io' });
    expect(src).toContain("FOLDER_ID = 'F1234567890abcdef'");
    expect(src).toContain("insertSheet('published')");
  });
});
