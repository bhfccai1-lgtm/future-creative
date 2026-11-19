import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { assessImage, meaningfulText, retryHint } from '@/lib/creative/image-quality';

const art = () => sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#88aacc' } }).composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">' + Array.from({ length: 200 }, (_, i) => `<circle cx="${(i * 97) % 1024}" cy="${(i * 53) % 1024}" r="${5 + (i % 30)}" fill="hsl(${(i * 37) % 360},70%,50%)"/>`).join('') + '</svg>') }]).png().toBuffer();
const flat = () => sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#f4b43c' } }).composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><circle cx="512" cy="512" r="300" fill="#b4361c"/></svg>') }]).png().toBuffer();

describe('image quality gate', () => {
  it('a sharp picture passes, the same picture blurred fails as soft; a flat illustration is not called soft', async () => {
    const a = await art();
    expect((await assessImage(a)).pass).toBe(true);
    const soft = await assessImage(await sharp(a).blur(4).png().toBuffer());
    expect(soft.pass).toBe(false); expect(soft.issues.map((i) => i.code)).toContain('soft');
    const f = await assessImage(await flat());
    expect(f.pass).toBe(true); expect(f.sharpness).toBeGreaterThan(0.4);
  });
  it('cut-outs must keep a margin from the borders and really be transparent', async () => {
    const mk = (r: number) => sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><circle cx="256" cy="256" r="${r}" fill="#e11d48"/></svg>`) }]).png().toBuffer();
    expect((await assessImage(await mk(180), { transparent: true })).pass).toBe(true);
    const cut = await assessImage(await mk(320), { transparent: true });
    expect(cut.pass).toBe(false); expect(cut.issues.map((i) => i.code)).toContain('cut');
    const opaque = await assessImage(await art(), { transparent: true });
    expect(opaque.issues.map((i) => i.code)).toContain('not_transparent');
  });
  it('text read inside the picture fails it; «no text» answers and lone marks do not', async () => {
    expect(meaningfulText('No text')).toBeNull(); expect(meaningfulText('none\n[?]\nA')).toBeNull();
    expect(meaningfulText('SALE 50%\nقهوة')).toContain('SALE');
    const q = await assessImage(await art(), { readText: async () => 'OPEN 24h' });
    expect(q.pass).toBe(false); expect(q.text).toContain('OPEN'); expect(q.score).toBeLessThanOrEqual(50);
    expect(retryHint(q)).toContain('ZERO letters');
    const clean = await assessImage(await art(), { readText: async () => 'There is no visible text.' });
    expect(clean.pass).toBe(true);
    const broken = await assessImage(await art(), { readText: async () => { throw new Error('vision down'); } });
    expect(broken.pass).toBe(true); expect(broken.issues.map((i) => i.code)).toContain('text_unchecked');
  });
});
