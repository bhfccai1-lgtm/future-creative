/**
 * Renders preview advertisements locally (no AI, no DB) using the dry-run scene generator and a
 * placeholder logo — for visual verification of the layout engine before activation.
 * Usage: npx tsx scripts/render-preview.ts [outDir] [path/to/logo.png]
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { composeAdvertisement, toJpeg } from '../src/lib/render/compose';
import { DryRunProvider } from '../src/lib/ai/dry-run-provider';
import { TEMPLATES } from '../src/lib/render/templates';

async function placeholderLogo() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="240"><rect x="4" y="4" width="592" height="232" rx="30" fill="none" stroke="#d4af37" stroke-width="8"/><text x="300" y="150" font-size="80" text-anchor="middle" fill="#d4af37" font-family="sans-serif">LOGO</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main() {
  const out = process.argv[2] ?? './data/previews';
  await fs.mkdir(out, { recursive: true });
  const logo = process.argv[3] ? await fs.readFile(process.argv[3]) : await placeholderLogo();
  const scene = (await new DryRunProvider().generateScene('', { size: '1024x1536', seedHint: 'preview' })).png;
  const samples = [
    { lang: 'ar' as const, headline: 'ملصقات تبرز علامتك التجارية', support: 'اطبع شعارك على كل منتج بجودة عالية', cta: 'اطلب الآن', contacts: [{ key: 'saar', label: 'فرع سار', phone: '33316319' }, { key: 'salmabad', label: 'فرع سلماباد', phone: '34315316' }] },
    { lang: 'en' as const, headline: 'A Mug Printed With Your Design', support: 'An everyday gift with a memory', cta: 'Order Now', contacts: [{ key: 'saar', label: 'Saar', phone: '33316319' }, { key: 'salmabad', label: 'Salmabad', phone: '34315316' }] },
    { lang: 'ml' as const, headline: 'ഗുണമേന്മയുള്ള പ്രിന്റിംഗ്', support: 'നിങ്ങളുടെ ബ്രാൻഡിന് സ്റ്റിക്കറുകൾ', cta: 'ഇപ്പോൾ ഓർഡർ ചെയ്യൂ', contacts: [{ key: 'saar', label: 'സാർ', phone: '33316319' }, { key: 'salmabad', label: 'സൽമാബാദ്', phone: '34315316' }] },
  ];
  for (const t of TEMPLATES) for (const s of samples) {
    const r = await composeAdvertisement({ scene, format: 'IMAGE_STORY', lang: s.lang, templateKey: t.key, headline: s.headline, supportingCopy: s.support, cta: s.cta, logo, contacts: s.contacts });
    const f = path.join(out, `${t.key}-${s.lang}.jpg`);
    await fs.writeFile(f, await toJpeg(r.png));
    console.log(f, r.manifest.layers.map((l) => `${l.id}:${l.fits ? 'ok' : 'OVERFLOW'}${l.missing.length ? ' missing=' + l.missing.join('') : ''}`).join(' '));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
