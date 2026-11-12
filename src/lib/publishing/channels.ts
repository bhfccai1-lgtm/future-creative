import type { MediaFormat, SocialPlatform } from '@prisma/client';

/**
 * Which networks accept which format through Metricool:
 *  - Stories exist only on Instagram and Facebook.
 *  - YouTube (Shorts) needs a video. Carousels: Instagram, Facebook, LinkedIn, Threads.
 *  - Google Business Profile is handled separately (gbpAuto, its own text rules).
 */
export const FORMAT_CHANNELS: Record<MediaFormat, SocialPlatform[]> = {
  IMAGE_STORY: ['instagram', 'facebook'],
  REEL_VIDEO: ['instagram', 'facebook', 'tiktok', 'youtube', 'threads', 'linkedin', 'twitter', 'pinterest'],
  IMAGE_FEED: ['instagram', 'facebook', 'tiktok', 'threads', 'linkedin', 'twitter', 'pinterest'],
  IMAGE_SQUARE: ['instagram', 'facebook', 'tiktok', 'threads', 'linkedin', 'twitter', 'pinterest'],
  IMAGE_CAROUSEL: ['instagram', 'facebook', 'threads', 'linkedin'],
};

/** Networks with short text limits get their OWN job so their text is fitted to them without cutting the Instagram caption. */
export const SEPARATE_TEXT: SocialPlatform[] = ['twitter', 'threads', 'pinterest', 'gmb'];

export const linkedNetworks = (snapshot: unknown): string[] => ((snapshot as { networks?: { network: string }[] } | null)?.networks ?? []).map((n) => n.network);

/** The account's automatic channels that this post can really go to (linked on the brand, format-compatible, Pinterest board set). */
export function autoChannelsFor(account: { platform: SocialPlatform; autoChannels: SocialPlatform[]; pinterestBoard: string | null; connection: { providerSnapshot: unknown } | null }, format: MediaFormat): SocialPlatform[] {
  const linked = linkedNetworks(account.connection?.providerSnapshot);
  return account.autoChannels.filter((n) => n !== account.platform && n !== 'gmb' && linked.includes(n) && FORMAT_CHANNELS[format].includes(n) && (n !== 'pinterest' || !!account.pinterestBoard));
}

/** Splits a post's networks into publication jobs: one main job (long-text networks) + one per short-text network. */
export function splitJobs(nets: SocialPlatform[]): SocialPlatform[][] {
  const main = nets.filter((n) => !SEPARATE_TEXT.includes(n));
  const solo = nets.filter((n) => SEPARATE_TEXT.includes(n)).map((n) => [n]);
  return main.length ? [main, ...solo] : solo;
}
