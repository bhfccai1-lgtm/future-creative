import type { SocialPlatform } from '@prisma/client';

/** Per-network text limits (characters) and hashtag caps used when one post targets several networks. */
export const TEXT_LIMITS: Record<SocialPlatform, number> = { twitter: 280, threads: 500, instagram: 2200, tiktok: 2200, linkedin: 3000, facebook: 5000, youtube: 5000, pinterest: 500, gmb: 1500 };
/** Instagram caps posts at 5 hashtags (2025+): more risk rejection and look spammy. */
export const HASHTAG_LIMITS: Record<SocialPlatform, number> = { twitter: 2, threads: 1, instagram: 5, tiktok: 10, linkedin: 5, facebook: 10, youtube: 15, pinterest: 10, gmb: 0 };

/** Conservative length: emoji / astral symbols count double (X weights them as 2). */
export const weightedLength = (s: string) => [...s].reduce((n, ch) => n + (ch.codePointAt(0)! > 0xffff ? 2 : 1), 0);

export function splitCaption(caption: string): { body: string; hashtags: string[] } {
  const hashtags = [...new Set(caption.match(/#[\p{L}\p{M}\p{N}_\u200c\u200d]+/gu) ?? [])];
  const body = caption.replace(/#[\p{L}\p{M}\p{N}_\u200c\u200d]+/gu, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { body, hashtags };
}

/**
 * Builds the post text that fits EVERY chosen network: the strictest network decides the length and
 * hashtag count. The verified contact line is always kept; body lines are dropped from the end first
 * (the hook on line 1 is kept), then the text is cut on a word boundary.
 */
export function fitCaption(caption: string, contactLine: string, networks: SocialPlatform[], opts: { hashtagsSeparately?: boolean } = {}) {
  const nets = networks.length ? networks : (['instagram'] as SocialPlatform[]);
  const limit = Math.min(...nets.map((n) => TEXT_LIMITS[n] ?? 2200));
  const maxTags = Math.min(...nets.map((n) => HASHTAG_LIMITS[n] ?? 10));
  const { body, hashtags } = splitCaption(caption);
  const tags = hashtags.slice(0, maxTags);
  const tagLine = opts.hashtagsSeparately ? '' : tags.join(' ');
  const assemble = (lines: string[]) => [lines.join('\n').trim(), contactLine, tagLine].filter(Boolean).join('\n\n');
  let lines = body.split('\n');
  let text = assemble(lines);
  while (weightedLength(text) > limit && lines.length > 1) { lines = lines.slice(0, -1); text = assemble(lines); }
  if (weightedLength(text) > limit) {
    const room = limit - weightedLength(assemble([])) - 3;
    let hook = lines[0] ?? '';
    while (weightedLength(hook) > Math.max(0, room)) hook = hook.split(' ').slice(0, -1).join(' ');
    text = assemble([hook ? `${hook}…` : '']);
  }
  return { text, hashtags: opts.hashtagsSeparately ? tags : [], limit };
}

/**
 * Google Business Profile post text. Google rejects profile posts that contain phone numbers (customers use the
 * profile's Call button) and hashtags have no effect there — so both are removed, and a local line naming both
 * branches is added for local search ("مطبعة في سار / سلماباد"). Max 1500 characters.
 */
export function gbpText(caption: string, localLine: string): string {
  const { body } = splitCaption(caption);
  const clean = body
    .split('\n')
    .map((l) => l.replace(/(?:\+?973[\s-]?)?\b\d{8}\b/g, '').replace(/#[^\s#]+/g, '').replace(/[📞☎️]\s*/gu, '').trim())
    .filter((l) => l && !/^[\s:|·•-]*$/.test(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
  const out = `${clean}\n\n${localLine}`.trim();
  return [...out].length <= 1500 ? out : [...clean].slice(0, 1500 - [...localLine].length - 3).join('').trimEnd() + '…\n\n' + localLine;
}
