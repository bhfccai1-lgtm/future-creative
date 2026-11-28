import { describe, expect, it } from 'vitest';
import { COPY_DISTANCE, inspirationBrief, inspirationQuery, nearestReference, parseFreepik, parsePrinciples, pickDiverse, searchFreepik, type InspirationRef } from '@/lib/creative/inspiration';

const item = (i: number, o: Record<string, unknown> = {}) => ({ id: i, title: `ref ${i}`, url: `https://www.freepik.com/free-photo/x_${i}.htm`, image: { type: i % 2 ? 'photo' : 'psd', source: { url: `https://img.freepik.com/x_${i}.jpg` } }, author: { name: `author${i % 4}` }, licenses: [{ type: i % 3 ? 'freemium' : 'premium' }], ...o });

describe('visual inspiration (Freepik): references → principles, never copies', () => {
  it('parses Freepik resources tolerantly: licence, type, author; drops items without https links or a preview', () => {
    const refs = parseFreepik({ data: [item(1), item(3), item(4, { image: {} }), item(5, { url: 'http://insecure' }), { title: 'no id' }] });
    expect(refs.map((r) => r.id)).toEqual(['1', '3']);
    expect(refs[0]).toMatchObject({ license: 'freemium', type: 'photo', author: 'author1', thumb: 'https://img.freepik.com/x_1.jpg' });
    expect(parseFreepik({ data: [item(3)] })[0].license).toBe('premium');
    expect(parseFreepik({ nothing: true })).toEqual([]);
  });
  it('picks 5–10 diverse references: one per author first, then the rest by relevance', () => {
    const refs = parseFreepik({ data: Array.from({ length: 20 }, (_, i) => item(i + 1)) });
    const p = pickDiverse(refs, 8);
    expect(p).toHaveLength(8);
    expect(new Set(p.slice(0, 4).map((r) => r.author)).size).toBe(4); // the 4 authors come first
    expect(pickDiverse(refs, 2)).toHaveLength(5); // never fewer than 5 when available
    expect(pickDiverse(refs, 50)).toHaveLength(10); // never more than 10
    expect(pickDiverse(refs.slice(0, 3), 8)).toHaveLength(3); // fewer available → what exists
  });
  it('the search phrase: product + occasion, framed as advertising product photography', () => {
    expect(inspirationQuery({ titleEn: 'Ceramic mugs', occasion: 'mothers_day' })).toBe('Ceramic mugs mothers day advertising product photography');
    expect(inspirationQuery({ titleEn: 'Stickers', occasion: 'everyday' })).toBe('Stickers advertising product photography');
  });
  it('principles become a brief that demands an ORIGINAL idea that beats the references', () => {
    const p = parsePrinciples({ composition: 'low hero angle', colors: 'warm amber', lighting: 'soft window light', productPresentation: 'in use', mood: 'cosy', takeaways: ['one hero', 'human hands'], avoid: ['flat lay clutter'] })!;
    const b = inspirationBrief(p, 8);
    expect(b).toMatch(/8 Freepik references/); expect(b).toMatch(/never copy any reference/); expect(b).toMatch(/ORIGINAL and beat these references/);
    expect(b).toContain('flat lay clutter');
    expect(parsePrinciples({})).toBeNull();
  });
  it('a design that is a near copy of a reference is detected by perceptual hash', () => {
    const a = 'ffffffffffffffff', b = 'fffffffffffff000', far = '0000000000000000';
    expect(nearestReference(a, [{ id: 'r1', hash: far }, { id: 'r2', hash: b }])).toEqual({ id: 'r2', distance: 12 });
    expect(nearestReference(a, [{ id: 'r1', hash: a }])!.distance).toBeLessThanOrEqual(COPY_DISTANCE);
    expect(nearestReference(a, [])).toBeNull();
  });
  it('the API call: key header, relevance, the free-licence filter; a refused key gives an Arabic reason', async () => {
    let seen: { url: URL; key: string | null } | null = null;
    const ok = (async (u: string, init: RequestInit) => { seen = { url: new URL(u), key: new Headers(init.headers).get('x-freepik-api-key') }; return new Response(JSON.stringify({ data: [item(1)] }), { status: 200 }); }) as unknown as typeof fetch;
    const refs: InspirationRef[] = await searchFreepik('k-123', 'mug ad', { freeOnly: true, fetchImpl: ok });
    expect(refs).toHaveLength(1);
    expect(seen!.key).toBe('k-123');
    expect(seen!.url.pathname).toBe('/v1/resources');
    expect(seen!.url.searchParams.get('term')).toBe('mug ad');
    expect(seen!.url.searchParams.get('filters[license][freemium]')).toBe('1');
    const denied = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
    await expect(searchFreepik('bad', 'x', { fetchImpl: denied })).rejects.toThrow(/رفض المفتاح/);
  });
});
