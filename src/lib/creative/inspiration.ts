import sharp from 'sharp';
import { phash, hamming } from '../dedup/phash';

/**
 * VISUAL INSPIRATION RESEARCH (owner's rule: Freepik as the source of visual inspiration before every design).
 *  1. search Freepik for the product / occasion and keep 5–10 DIVERSE references (different authors and types)
 *  2. a vision model extracts the PRINCIPLES only — composition, colours, light, how the product is presented
 *  3. the creative director receives the principles (never the images) and must create an ORIGINAL idea that beats
 *     them on attention, clarity and distinction
 *  4. every reference is logged with its link, author and licence; the finished design is compared with each
 *     reference's perceptual hash and a near-copy BLOCKS approval
 * Rights: the references are looked at for analysis only — they are never sent to the image model, never stored or
 * reused in a design; only their metadata and a 64-bit perceptual hash are kept.
 */
export interface InspirationRef {
  id: string; title: string; url: string; thumb: string; author: string;
  /** Freepik licence: «freemium» needs attribution when used, «premium» needs a subscription — we never use the asset itself */
  license: 'freemium' | 'premium' | 'unknown'; type: string;
}
export interface InspirationPrinciples {
  composition: string; colors: string; lighting: string; productPresentation: string; mood: string;
  /** what makes the best references work, as transferable lessons */
  takeaways: string[];
  /** clichés seen across the references that an original idea must avoid */
  avoid: string[];
}

export const FREEPIK_API = 'https://api.freepik.com/v1/resources';

/** the search phrase: the product in English + the occasion, framed as advertising / product photography */
export function inspirationQuery(p: { titleEn: string; occasion?: string | null }): string {
  const occ = p.occasion && p.occasion !== 'everyday' ? ` ${p.occasion.replace(/_/g, ' ')}` : '';
  return `${p.titleEn}${occ} advertising product photography`.replace(/\s+/g, ' ').trim().slice(0, 100);
}

/** tolerant parser for Freepik's /v1/resources answer ({data:[{id,title,url,image:{source:{url}},author:{name},licenses:[{type}]}]}) */
export function parseFreepik(json: unknown): InspirationRef[] {
  const arr = (json as { data?: unknown })?.data;
  if (!Array.isArray(arr)) return [];
  return (arr as Record<string, unknown>[]).map((r) => {
    const img = (r.image ?? {}) as { type?: string; source?: { url?: string } };
    const lic = Array.isArray(r.licenses) ? (r.licenses as { type?: string }[]).map((l) => String(l.type ?? '').toLowerCase()) : [];
    const premium = r.premium === true || lic.includes('premium');
    return {
      id: String(r.id ?? ''), title: String(r.title ?? '').slice(0, 160), url: String(r.url ?? ''),
      thumb: String(img.source?.url ?? (r.thumbnail as { url?: string } | undefined)?.url ?? ''), author: String((r.author as { name?: string } | undefined)?.name ?? ''),
      license: premium ? 'premium' : lic.includes('freemium') || r.premium === false ? 'freemium' : 'unknown', type: String(img.type ?? r.type ?? ''),
    } as InspirationRef;
  }).filter((r) => r.id && r.thumb && /^https:\/\//.test(r.thumb) && /^https:\/\//.test(r.url));
}

export async function searchFreepik(apiKey: string, term: string, o: { limit?: number; freeOnly?: boolean; fetchImpl?: typeof fetch } = {}): Promise<InspirationRef[]> {
  const u = new URL(FREEPIK_API);
  u.searchParams.set('term', term);
  u.searchParams.set('limit', String(Math.min(30, o.limit ?? 24)));
  u.searchParams.set('order', 'relevance');
  if (o.freeOnly) u.searchParams.set('filters[license][freemium]', '1');
  const r = await (o.fetchImpl ?? fetch)(u.toString(), { headers: { 'x-freepik-api-key': apiKey, Accept: 'application/json', 'Accept-Language': 'en-US' }, signal: AbortSignal.timeout(20_000) });
  if (r.status === 401 || r.status === 403) throw new Error(`Freepik رفض المفتاح (${r.status}) — تحقق من مفتاح Freepik API في الإعدادات.`);
  if (r.status === 429) throw new Error('Freepik: تجاوزنا حد الطلبات — يُعاد في التصميم القادم.');
  if (!r.ok) throw new Error(`Freepik HTTP ${r.status}`);
  return parseFreepik(await r.json());
}

/** 5–10 references, as diverse as possible: one per author first, alternating types, then the rest by relevance */
export function pickDiverse(refs: InspirationRef[], n = 8): InspirationRef[] {
  const want = Math.max(5, Math.min(10, n));
  const out: InspirationRef[] = [], authors = new Set<string>(), types = new Map<string, number>();
  const firstPass = [...refs].sort((a, b) => (types.get(a.type) ?? 0) - (types.get(b.type) ?? 0));
  for (const r of firstPass) {
    if (out.length >= want) break;
    if (r.author && authors.has(r.author)) continue;
    out.push(r); authors.add(r.author); types.set(r.type, (types.get(r.type) ?? 0) + 1);
  }
  for (const r of refs) { if (out.length >= want) break; if (!out.includes(r)) out.push(r); }
  return out;
}

/** small previews for the vision model and the hashes (kept in memory only — never stored) */
export async function fetchPreviews(refs: InspirationRef[], fetchImpl: typeof fetch = fetch): Promise<{ ref: InspirationRef; jpeg: Buffer; hash: string }[]> {
  const out: { ref: InspirationRef; jpeg: Buffer; hash: string }[] = [];
  for (const ref of refs) {
    try {
      const r = await fetchImpl(ref.thumb, { signal: AbortSignal.timeout(15_000) });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 6_000_000) continue;
      const jpeg = await sharp(buf).resize({ width: 384, height: 384, fit: 'inside' }).jpeg({ quality: 72 }).toBuffer();
      out.push({ ref, jpeg, hash: await phash(buf) });
    } catch { /* one unreachable preview never blocks the research */ }
  }
  return out;
}

/** vision instructions: principles, not descriptions to copy */
export function principlesPrompt(ctx: { product: string; audience: string; n: number }) {
  return [
    `You are a world-class creative director studying ${ctx.n} reference advertisements for «${ctx.product}» (audience: ${ctx.audience}).`,
    'Extract TRANSFERABLE PRINCIPLES only — never describe a specific reference so it could be copied, never mention brands, logos or text in them.',
    'Answer in JSON: {"composition": "...", "colors": "...", "lighting": "...", "productPresentation": "...", "mood": "...", "takeaways": ["3–5 lessons that make the best ones work"], "avoid": ["2–4 clichés repeated across them"]}',
    'Each field: one or two concise sentences in English.',
  ].join('\n');
}

const str = (v: unknown, n = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export function parsePrinciples(j: unknown): InspirationPrinciples | null {
  const o = (j ?? {}) as Record<string, unknown>;
  const p: InspirationPrinciples = {
    composition: str(o.composition), colors: str(o.colors), lighting: str(o.lighting), productPresentation: str(o.productPresentation), mood: str(o.mood),
    takeaways: (Array.isArray(o.takeaways) ? o.takeaways : []).map((x) => str(x, 200)).filter(Boolean).slice(0, 5),
    avoid: (Array.isArray(o.avoid) ? o.avoid : []).map((x) => str(x, 160)).filter(Boolean).slice(0, 4),
  };
  return p.composition || p.takeaways.length ? p : null;
}

/** what the creative director receives (added to the brief request) */
export function inspirationBrief(p: InspirationPrinciples, n: number): string {
  return [
    `VISUAL RESEARCH — ${n} Freepik references were analysed. Use these PRINCIPLES; never copy any reference's idea, layout or scene.`,
    `Composition: ${p.composition}`, `Colours: ${p.colors}`, `Light: ${p.lighting}`, `Product presentation: ${p.productPresentation}`, `Mood: ${p.mood}`,
    p.takeaways.length ? `What works: ${p.takeaways.join(' · ')}` : '',
    p.avoid.length ? `Clichés to avoid (they are everywhere): ${p.avoid.join(' · ')}` : '',
    'Your idea must be ORIGINAL and beat these references on attention, clarity and visual distinction — ULTRA PREMIUM.',
  ].filter(Boolean).join('\n');
}

/** perceptual distance from the finished design to the nearest reference (64-bit pHash; ≤ 10 = a near copy) */
export const COPY_DISTANCE = 10;
export function nearestReference(designHash: string, refHashes: { id: string; hash: string }[]): { id: string; distance: number } | null {
  let best: { id: string; distance: number } | null = null;
  for (const r of refHashes) { const d = hamming(designHash, r.hash); if (!best || d < best.distance) best = { id: r.id, distance: d }; }
  return best;
}
