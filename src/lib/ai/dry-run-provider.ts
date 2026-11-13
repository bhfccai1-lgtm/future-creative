import sharp from 'sharp';
import { createHash } from 'node:crypto';
import type { AiProvider, BriefRequest, CreativeBriefOut, IdeaSuggestion } from './types';
import { CONTENT_TYPES, findOccasion, MARKETS, SEGMENTS } from '../creative/options';

/**
 * Offline provider: no external API calls and no cost. Produces a deterministic but varied
 * concept from the product's approved messages and a procedural (clearly synthetic) scene.
 * Advertisements produced here are flagged dryRun=true and can NEVER be published.
 */
const ANGLES = [
  { key: 'craft-detail', en: 'macro detail of print quality' },
  { key: 'in-use', en: 'product shown in real daily use' },
  { key: 'gift-moment', en: 'the product as a meaningful gift' },
  { key: 'business-growth', en: 'helping a local business look professional' },
  { key: 'occasion', en: 'celebrating a specific occasion' },
  { key: 'flat-lay', en: 'premium top-down flat lay' },
  { key: 'before-launch', en: 'getting ready for a launch or opening' },
  { key: 'team-identity', en: 'unified team / brand identity' },
];

const HEADLINES: Record<'ar' | 'en' | 'ml', string[]> = {
  ar: ['اطبع فكرتك بإبداع', 'تفاصيل تصنع الفرق', 'هويتك تستحق الأفضل', 'جودة تراها وتلمسها', 'لمسة احترافية لعلامتك', 'من التصميم إلى الطباعة', 'اصنع انطباعًا يدوم', 'أفكارك بين يديك'],
  en: ['Print Your Idea Beautifully', 'Details Make the Difference', 'Your Brand, Printed Right', 'Quality You Can Feel', 'A Professional Touch', 'From Design to Print', 'Make a Lasting Impression', 'Your Ideas in Hand'],
  ml: ['നിങ്ങളുടെ ആശയം പ്രിന്റ് ചെയ്യൂ', 'ഗുണമേന്മയുള്ള പ്രിന്റിംഗ്', 'നിങ്ങളുടെ ബ്രാൻഡിനായി', 'മികച്ച ഡിസൈൻ, മികച്ച പ്രിന്റ്'],
};

const hashInt = (s: string) => parseInt(createHash('sha256').update(s).digest('hex').slice(0, 8), 16);

export class DryRunProvider implements AiProvider {
  readonly name = 'dry-run';
  readonly isDryRun = true;

  async writeVoiceover(req: import('./types').VoiceoverRequest) {
    const c = req.copy;
    const script = [c.headline, c.badge, c.support, c.cta].filter(Boolean).join('، ').split(/\s+/).slice(0, req.maxWords).join(' ');
    return { script, model: 'dry-run', usage: { inputTokens: 0, outputTokens: 0 } };
  }

  async generateBrief(req: BriefRequest) {
    const p = req.product;
    const lang = req.language;
    const title = lang === 'ar' ? p.titleAr : lang === 'ml' ? (p.titleMl ?? p.titleEn) : p.titleEn;
    // enumerate (angle × occasion) and pick the first combination not in the avoid list
    const chosenOcc = findOccasion(req.occasionKey);
    const occs = chosenOcc && chosenOcc.value !== 'everyday' ? [chosenOcc.en] : p.occasions.length ? p.occasions : ['everyday'];
    const combos = ANGLES.flatMap((a) => occs.map((o) => ({ a, o, key: `${p.slug}-${a.key}-${o.replace(/\s+/g, '-')}` })));
    const offset = hashInt(req.accountName + p.slug) % combos.length;
    const avoid = new Set(req.avoidIdeas.map((x) => x.toLowerCase()));
    let pick = combos[(offset + req.attempt) % combos.length];
    for (let i = 0; i < combos.length; i++) {
      const c = combos[(offset + req.attempt + i) % combos.length];
      if (!avoid.has(c.key)) { pick = c; break; }
    }
    const hl = HEADLINES[lang];
    const avoidH = new Set(req.avoidHeadlines);
    const occHeadline = lang === 'ar' ? chosenOcc?.headlineAr : lang === 'en' ? chosenOcc?.headlineEn : undefined;
    let headline = occHeadline && !avoidH.has(occHeadline) ? occHeadline : hl[(hashInt(pick.key) + req.attempt) % hl.length];
    for (let i = 0; i < hl.length && avoidH.has(headline); i++) headline = hl[(hashInt(pick.key) + i + 1) % hl.length];
    const msgs = p.recommendedMessages[lang] ?? p.recommendedMessages.en ?? [];
    const support = msgs.length ? msgs[hashInt(pick.key) % msgs.length] : title;
    const brief: CreativeBriefOut = {
      idea: `${p.name}: ${pick.a.en} — ${pick.o}${req.direction?.userIdea ? ` — ${req.direction.userIdea}` : ''}`,
      ideaKey: pick.key,
      audience: p.targetAudience[hashInt(pick.key) % Math.max(1, p.targetAudience.length)] ?? 'general',
      occasion: pick.o,
      sceneDescription: `${p.visualGuidelines} Angle: ${pick.a.en}. Occasion: ${pick.o}.${req.direction ? ' Direction: ' + Object.values(req.direction).join('; ') + '.' : ''} No text, no logos.`,
      headline,
      badge: (lang === 'ar' ? p.titleAr : lang === 'ml' ? (p.titleMl ?? p.titleEn) : p.titleEn).split(/\s+/).slice(-2).join(' ').slice(0, 24),
      supportingCopy: support.slice(0, 100),
      cta: req.defaultCta,
      caption: `${title} — ${support}`,
      hashtags: lang === 'ar' ? ['#البحرين', '#مطبعة', '#طباعة'] : ['#Bahrain', '#Printing'],
      styleNotes: 'dry-run procedural preview',
      // carousel: approved product messages become slides (pipeline tops up to 3 with truthful generic slides)
      storyboard: req.format === 'REEL_VIDEO' ? (['hook', 'context', 'product', 'benefit'] as const).map((beat, i) => ({ beat, scene: `${req.product.titleEn} — ${beat} shot ${i + 1}, premium commercial photo` })) : [],
      slides: req.format === 'IMAGE_CAROUSEL' ? msgs.slice(0, 4).map((m, i) => ({ title: `${title} ${i + 1}`.slice(0, 40), body: m.slice(0, 200) })) : [],
    };
    return { brief, model: 'dry-run', usage: { inputTokens: 0, outputTokens: 0 } };
  }

  /** Offline idea suggestions assembled from the selected options (no API call, no cost). */
  async suggestIdeas(req: BriefRequest, _model: string, count: number) {
    const lang = req.language;
    const t = (o?: { ar: string; en: string }) => (o ? (lang === 'ar' ? o.ar : o.en) : '');
    const title = lang === 'ar' ? req.product.titleAr : lang === 'ml' ? (req.product.titleMl ?? req.product.titleEn) : req.product.titleEn;
    const d = req.direction ?? {};
    const pickBy = (list: { prompt: string; ar: string; en: string }[], prompt?: string) => list.find((o) => o.prompt === prompt);
    const occ = findOccasion(req.occasionKey);
    const seg = pickBy(SEGMENTS, d.targetSegment);
    const mk = pickBy(MARKETS, d.marketAndAudience);
    const types = d.contentType ? [pickBy(CONTENT_TYPES, d.contentType)!, ...CONTENT_TYPES] : CONTENT_TYPES;
    const off = hashInt(req.product.slug + (req.occasionKey ?? '') + req.attempt) % CONTENT_TYPES.length;
    const ideas: IdeaSuggestion[] = [];
    for (let i = 0; ideas.length < count && i < types.length + CONTENT_TYPES.length; i++) {
      const ct = i === 0 && d.contentType ? types[0] : CONTENT_TYPES[(off + i) % CONTENT_TYPES.length];
      const parts = [t(ct), occ && occ.value !== 'everyday' ? t(occ) : '', seg ? t(seg) : '', mk ? t(mk) : ''].filter(Boolean);
      const idea = lang === 'ar'
        ? `${title}: ${parts.join(' — ')}. مشهد فاخر يبرز المنتج بوضوح مع إضاءة سينمائية.`
        : `${title}: ${parts.join(' — ')}. A premium scene that clearly features the product with cinematic lighting.`;
      const angle = req.ideaContext?.angles?.[ideas.length] ?? 'problem_solution';
      if (!ideas.some((x) => x.idea === idea)) ideas.push({ title: `${t(ct)}`, idea, hook: title, angle, format: ['REEL_VIDEO', 'IMAGE_CAROUSEL', 'IMAGE_FEED'][ideas.length % 3], score: 6, why: 'dry-run' });
    }
    return { ideas, model: 'dry-run', usage: { inputTokens: 0, outputTokens: 0 } };
  }

  async generateScene(_prompt: string, opts: { size: string; seedHint: string }) {
    const [w, h] = opts.size.split('x').map(Number);
    const n = hashInt(opts.seedHint);
    const hue = n % 360;
    const shapes = Array.from({ length: 7 }, (_, i) => {
      const k = hashInt(opts.seedHint + i);
      const cx = (k % w), cy = h * 0.3 + ((k >> 8) % Math.floor(h * 0.4)), r = 40 + ((k >> 4) % 160);
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="hsl(${(hue + i * 25) % 360},55%,${45 + (i % 3) * 8}%)" opacity="0.35"/>`;
    }).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1730"/><stop offset="0.55" stop-color="#1a3266"/><stop offset="1" stop-color="#060d1e"/></linearGradient>
      <radialGradient id="s" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#d4af37" stop-opacity="0.55"/><stop offset="1" stop-color="#d4af37" stop-opacity="0"/></radialGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/>${shapes}
      <ellipse cx="${w * (0.3 + ((n >> 3) % 40) / 100)}" cy="${h * (0.4 + ((n >> 6) % 25) / 100)}" rx="${w * 0.42}" ry="${h * 0.2}" fill="url(#s)"/>
      <rect x="${w * (0.12 + ((n >> 9) % 40) / 100)}" y="${h * (0.3 + ((n >> 12) % 30) / 100)}" width="${w * (0.25 + ((n >> 15) % 25) / 100)}" height="${h * (0.15 + ((n >> 18) % 20) / 100)}" rx="${10 + (n % 40)}" fill="#f5f1e6" stroke="#d4af37" stroke-width="8" transform="rotate(${(n % 31) - 15} ${w / 2} ${h / 2})"/>
      <rect x="${w * (0.05 + ((n >> 21) % 50) / 100)}" y="${h * (0.55 + ((n >> 24) % 20) / 100)}" width="${w * 0.3}" height="${h * 0.12}" rx="14" fill="hsl(${(hue + 140) % 360},50%,40%)" opacity="0.85"/>
    </svg>`;
    return { png: await sharp(Buffer.from(svg)).png().toBuffer(), model: 'dry-run' };
  }
}
