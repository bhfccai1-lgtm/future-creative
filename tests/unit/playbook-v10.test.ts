import { describe, expect, it } from 'vitest';
import { contactFooter } from '@/lib/publishing/publisher';
import { briefSystemPrompt, fullPosterPrompt, NEGATIVE_PROMPT, scenePrompt } from '@/lib/ai/prompts';
import { findWrongPhones } from '@/lib/qc/checks';
import { SettingsSchema } from '@/lib/settings';

const locs = [{ nameAr: 'سار', nameEn: 'Saar', nameMl: 'സാർ', nameHi: 'सार', phone: '33316319' }, { nameAr: 'سلماباد', nameEn: 'Salmabad', nameMl: 'സൽമാബാദ്', nameHi: 'सलमाबाद', phone: '34315316' }];

describe('Creative Design Playbook V10.0', () => {
  it('§8 delivery 33930900: on by default, added to the caption contact line in the post language (never to the design panel)', () => {
    const s = SettingsSchema.parse({});
    expect(s.publishing.delivery).toEqual({ enabled: true, phone: '33930900' });
    expect(contactFooter('ar', locs, '33930900')).toBe('📞 سار 33316319 | سلماباد 34315316 | 🚚 التوصيل 33930900');
    expect(contactFooter('en', locs, '33930900')).toContain('🚚 Delivery 33930900');
    expect(contactFooter('ml', locs, '33930900')).toContain('🚚 ഡെലിവറി 33930900');
    expect(contactFooter('hi', locs, '33930900')).toContain('🚚 डिलीवरी 33930900');
    expect(contactFooter('ar', locs)).toBe('📞 سار 33316319 | سلماباد 34315316'); // switched off → unchanged
  });
  it('§8 the delivery number is an approved number in the text; any other number is still a blocker', () => {
    const approved = ['33316319', '34315316'];
    expect(findWrongPhones('للتوصيل 33930900', [...approved, '33930900'])).toEqual([]);
    expect(findWrongPhones('للتوصيل 33930900', approved)).toEqual(['33930900']);
    expect(findWrongPhones('اتصل 39999999', [...approved, '33930900'])).toEqual(['39999999']);
  });
  it('§2 the idea engine: the need first, 10 genuinely different ideas across the 10 approaches, scored, top 3, the best developed', () => {
    const p = briefSystemPrompt();
    expect(p).toMatch(/customer need or problem/);
    expect(p).toMatch(/invent 10 GENUINELY different ideas/);
    for (const a of ['visual story', 'comic situation', 'ORIGINAL cartoon character', 'visual surprise', 'artistic metaphor', 'cinematic photography', 'luxury minimalism', 'real-life scene', 'creative fantasy', 'emotional moment']) expect(p).toContain(a);
    expect(p).toMatch(/Changing only the colours or the background is NOT a new idea/);
    expect(p).toMatch(/keep the top 3; develop the single best/);
  });
  it('§6 every image prompt carries one explicit negative prompt', () => {
    expect(NEGATIVE_PROMPT).toMatch(/^AVOID \(negative prompt\):/);
    expect(scenePrompt('a mug on a table', 'premium')).toContain(NEGATIVE_PROMPT);
    expect(fullPosterPrompt({ lang: 'ar', headline: 'صباحك', badge: 'أكواب', features: [], sceneDescription: 'a mug', style: 'premium', textless: { headlinePct: 18 } })).toContain(NEGATIVE_PROMPT);
  });
});
