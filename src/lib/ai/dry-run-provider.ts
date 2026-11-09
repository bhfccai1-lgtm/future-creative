import sharp from 'sharp';
import { createHash } from 'node:crypto';
import type { AiProvider, BriefRequest, CreativeBriefOut } from './types';

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

  async generateBrief(req: BriefRequest) {
    const p = req.product;
    const lang = req.language;
    const title = lang === 'ar' ? p.titleAr : lang === 'ml' ? (p.titleMl ?? p.titleEn) : p.titleEn;
    // enumerate (angle × occasion) and pick the first combination not in the avoid list
    const occs = p.occasions.length ? p.occasions : ['everyday'];
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
    let headline = hl[(hashInt(pick.key) + req.attempt) % hl.length];
    for (let i = 0; i < hl.length && avoidH.has(headline); i++) headline = hl[(hashInt(pick.key) + i + 1) % hl.length];
    const msgs = p.recommendedMessages[lang] ?? p.recommendedMessages.en ?? [];
    const support = msgs.length ? msgs[hashInt(pick.key) % msgs.length] : title;
    const brief: CreativeBriefOut = {
      idea: `${p.name}: ${pick.a.en} — ${pick.o}`,
      ideaKey: pick.key,
      audience: p.targetAudience[hashInt(pick.key) % Math.max(1, p.targetAudience.length)] ?? 'general',
      occasion: pick.o,
      sceneDescription: `${p.visualGuidelines} Angle: ${pick.a.en}. Occasion: ${pick.o}. No text, no logos.`,
      headline,
      supportingCopy: support.slice(0, 100),
      cta: req.defaultCta,
      caption: `${title} — ${support}`,
      hashtags: lang === 'ar' ? ['#البحرين', '#مطبعة', '#طباعة'] : ['#Bahrain', '#Printing'],
      styleNotes: 'dry-run procedural preview',
    };
    return { brief, model: 'dry-run', usage: { inputTokens: 0, outputTokens: 0 } };
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
      <ellipse cx="${w / 2}" cy="${h * 0.52}" rx="${w * 0.42}" ry="${h * 0.2}" fill="url(#s)"/>
      <rect x="${w * 0.3}" y="${h * 0.38}" width="${w * 0.4}" height="${h * 0.26}" rx="28" fill="#f5f1e6" stroke="#d4af37" stroke-width="8"/>
      <rect x="${w * 0.34}" y="${h * 0.42}" width="${w * 0.32}" height="${h * 0.18}" rx="14" fill="hsl(${hue},50%,40%)"/>
    </svg>`;
    return { png: await sharp(Buffer.from(svg)).png().toBuffer(), model: 'dry-run' };
  }
}
