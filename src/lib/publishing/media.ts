import type { MediaAsset, MediaFormat } from '@prisma/client';
import { sha256 } from '../crypto';

/** The exact media that will be published, in order: Reel → video; carousel → cover + slides; otherwise the final image. */
export function publishableMedia(ad: { format: MediaFormat; media: MediaAsset[] }): MediaAsset[] {
  if (ad.format === 'REEL_VIDEO') return ad.media.filter((m) => m.role === 'VIDEO');
  const cover = ad.media.filter((m) => m.role === 'FINAL');
  if (ad.format !== 'IMAGE_CAROUSEL') return cover;
  const idx = (m: MediaAsset) => Number((m.meta as { index?: number } | null)?.index ?? 0);
  return [...cover, ...ad.media.filter((m) => m.role === 'SLIDE').sort((a, b) => idx(a) - idx(b))];
}

/** One fingerprint for the whole publishable bundle (single file → its own SHA-256; carousel → SHA-256 of the ordered SHAs). */
export function bundleSha(shas: string[]): string {
  return shas.length === 1 ? shas[0] : sha256(Buffer.from(shas.join(':')));
}
