import { describe, expect, it } from 'vitest';
import { renderText } from '@/lib/render/text';
import { missingGlyphs } from '@/lib/render/fonts';
import { autoVoiceLang } from '@/lib/audio/voices';
import { detectLanguage } from '@/lib/comments/classify';
import { contactLines, ctaFor, CTA_HI } from '@/lib/business';
import { contactFooter } from '@/lib/publishing/publisher';
import type { Business } from '@prisma/client';

const biz = {
  defaultCtaAr: 'اطلب الآن', defaultCtaEn: 'Order now', defaultCtaMl: 'ഇപ്പോൾ ഓർഡർ ചെയ്യൂ',
  locations: [
    { key: 'saar', nameAr: 'سار', nameEn: 'Saar', nameMl: 'സാർ', phone: '33316319' }, // saved before Hindi: no nameHi
    { key: 'salmabad', nameAr: 'سلماباد', nameEn: 'Salmabad', nameHi: 'सलमाबाद', phone: '34315316' },
  ],
} as unknown as Business;

describe('Hindi (@bhfcc.india): everything in Hindi', () => {
  it('Devanagari renders with a real font: no missing glyphs, conjuncts and matras included', async () => {
    const text = 'अपनी यादों को प्रिंट करें — कस्टम मग और टी-शर्ट';
    expect(missingGlyphs(text, 'hi', 'bold')).toEqual([]);
    const r = await renderText({ text, lang: 'hi', weight: 'bold', color: '#ffffff', boxW: 900, boxH: 300, maxSize: 72, minSize: 24, maxLines: 2 } as Parameters<typeof renderText>[0]);
    expect(r.missing).toEqual([]);
    expect(r.fits).toBe(true);
    expect(r.width).toBeGreaterThan(100);
  });

  it('Hindi content is voiced in Hindi, even for the Indian-community market (which defaults to Malayalam)', () => {
    expect(autoVoiceLang({ market: 'indian_community', contentLang: 'hi' })).toBe('hi');
    expect(autoVoiceLang({ contentLang: 'hi' })).toBe('hi');
    expect(autoVoiceLang({ market: 'indian_community', contentLang: 'ml' })).not.toBe('hi');
  });

  it('Hindi comments are recognised', () => {
    expect(detectLanguage('इसकी कीमत क्या है?')).toBe('hi');
    expect(detectLanguage('ഇതിന്റെ വില എത്ര?')).toBe('ml');
  });

  it('branches, order button and caption footer in Hindi (old saved branches get the default Hindi name)', () => {
    expect(contactLines(biz, 'hi').map((c) => c.label)).toEqual(['सार ब्रांच', 'सलमाबाद ब्रांच']);
    expect(ctaFor(biz, 'hi')).toBe(CTA_HI);
    expect(ctaFor(biz, 'ml')).toBe('ഇപ്പോൾ ഓർഡർ ചെയ്യൂ'); // other languages unchanged
    expect(contactFooter('hi', [{ nameAr: 'سلماباد', nameEn: 'Salmabad', nameHi: 'सलमाबाद', phone: '34315316' }])).toBe('📞 सलमाबाद 34315316');
  });

  it('the caption footer asks to follow in Hindi', async () => {
    const { buildCaption } = await import('@/lib/pipeline/generate');
    const b = { caption: 'अपना नाम लिखवाएं ☕', hashtags: ['#बहरीन'] } as Parameters<typeof buildCaption>[0];
    expect(buildCaption(b, { mentions: ['@bhfcps', '@bhfcpss'], ownHandle: null, lang: 'hi' })).toBe('अपना नाम लिखवाएं ☕\n\nहमें फॉलो करें: @bhfcps @bhfcpss\n\n#बहरीन');
  });
});
