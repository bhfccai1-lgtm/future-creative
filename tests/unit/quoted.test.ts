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
    const src = appsScriptSource({ folderId: 'F1234567890abcdef', sheetId: 'S1234567890abcdef', host: 'example.sslip.io', key: 'K' });
    expect(src).toContain("FOLDER_ID = 'F1234567890abcdef'");
    expect(src).toContain("insertSheet('published')");
  });
});

describe('image realism rules', () => {
  it('every generated photo forbids the typical AI defects and asks for physically correct light', async () => {
    const { scenePrompt, fullPosterPrompt, REALISM_RULES } = await import('@/lib/ai/prompts');
    expect(REALISM_RULES).toMatch(/contact shadow/);
    expect(REALISM_RULES).toMatch(/five fingers/);
    expect(REALISM_RULES).toMatch(/melted, warped, duplicated or floating/);
    const scene = scenePrompt('a printed mug on a marble table', 'luxury');
    expect(scene).toContain(REALISM_RULES);
    expect(scene).toMatch(/ABSOLUTELY NO text/); // the existing rules stay
    const poster = fullPosterPrompt({ lang: 'ar', headline: 'هدية من القلب', badge: 'أكواب', features: [], sceneDescription: 'a printed mug', style: 'luxury' });
    expect(poster).toContain(REALISM_RULES);
    expect(scene.length).toBeLessThan(4000); // well inside the image model's prompt limit
  });
});

describe('caption mentions the owner’s Instagram accounts', () => {
  it('ends every caption with «تابعونا: @bhfcps @bhfcpss», never mentions an account in its own post, hashtags stay last', async () => {
    const { buildCaption } = await import('@/lib/pipeline/generate');
    const b = { caption: 'هدية تفرح القلب 🎁', hashtags: ['#البحرين', 'هدايا'] } as Parameters<typeof buildCaption>[0];
    const c = buildCaption(b, { mentions: ['@bhfcps', '@bhfcpss'], ownHandle: null, lang: 'ar' });
    expect(c).toBe('هدية تفرح القلب 🎁\n\nتابعونا: @bhfcps @bhfcpss\n\n#البحرين #هدايا');
    expect(buildCaption(b, { mentions: ['@bhfcps', '@bhfcpss'], ownHandle: 'BHFCPS', lang: 'ar' })).toContain('تابعونا: @bhfcpss\n'); // not itself
    expect(buildCaption(b, { mentions: ['@bhfcps'], ownHandle: '@bhfcps', lang: 'ar' })).not.toMatch(/تابعونا/); // nothing left to mention
    expect(buildCaption(b, { mentions: ['@bhfcps'], lang: 'en' })).toContain('Follow us: @bhfcps');
    expect(buildCaption(b)).toBe('هدية تفرح القلب 🎁\n\n#البحرين #هدايا'); // no mentions configured → unchanged
  });
});
