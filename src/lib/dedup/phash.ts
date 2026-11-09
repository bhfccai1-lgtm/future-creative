import sharp from 'sharp';

/**
 * 64-bit perceptual hash (DCT pHash): 32x32 greyscale → 2D DCT → top-left 8x8 (minus DC) vs median.
 * Implemented here (rather than an npm wrapper) so the algorithm is auditable and deterministic.
 */
export async function phash(img: Buffer): Promise<string> {
  const N = 32;
  const { data } = await sharp(img).greyscale().resize(N, N, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const px: number[][] = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => data[y * N + x]));
  const cos = Array.from({ length: N }, (_, k) => Array.from({ length: N }, (_, n) => Math.cos(((2 * n + 1) * k * Math.PI) / (2 * N))));
  const dct: number[] = [];
  for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) {
    let s = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) s += px[y][x] * cos[u][y] * cos[v][x];
    dct.push(s);
  }
  const coeffs = dct.slice(1);
  const med = [...coeffs].sort((a, b) => a - b)[Math.floor(coeffs.length / 2)];
  let bits = '';
  for (const c of dct) bits += c > med ? '1' : '0';
  return BigInt('0b' + bits).toString(16).padStart(16, '0');
}

export function hamming(a: string, b: string): number {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b), n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}
