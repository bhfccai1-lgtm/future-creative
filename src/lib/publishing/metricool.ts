import { fromZonedTime } from 'date-fns-tz';
import type { SocialPlatform } from '@prisma/client';
import type { ProviderProfile, PublishRequest, PublishingAdapter, RemoteStatus, SubmitOutcome } from './types';
import { localDateTime } from '../time';

/**
 * Metricool REST adapter.
 *
 * Request-body fields follow Metricool's scheduler schema (publicationDate{dateTime,timezone}, text,
 * providers[{network}], media[], autoPublish, draft, instagramData{type, isAiGenerated}, …).
 * ENDPOINT PATHS AND RESPONSE SHAPES MUST BE VERIFIED against the current official Metricool API
 * documentation for your account plan before going live — they are isolated in `ENDPOINTS` and
 * the `parse*` helpers below so they can be adjusted without touching the publishing logic.
 * Authentication: header `X-Mc-Auth: <token>` plus `userId` and `blogId` query parameters.
 */
export const ENDPOINTS = {
  profiles: '/admin/simpleProfiles',
  posts: '/v2/scheduler/posts',
  post: (id: string) => `/v2/scheduler/posts/${encodeURIComponent(id)}`,
  /** Per-post analytics (Instagram posts / reels / stories). VERIFY on a live account — see docs. */
  analytics: (kind: 'posts' | 'reels' | 'stories', network = 'instagram') => `/v2/analytics/${kind}/${network}`,
  /** Instagram competitors configured in Metricool (summary, posts, reels). VERIFY on a live account. */
  competitors: (part: '' | '/posts' | '/reels' = '', network = 'instagram') => `/v2/analytics/competitors/${network}${part}`,
};

/** Normalised per-post metrics read from the provider (absent metrics stay undefined — never invented). */
export interface ProviderPostMetrics {
  url?: string; postId?: string; publishedAt?: Date; kind: 'posts' | 'reels' | 'stories';
  reach?: number; views?: number; likes?: number; comments?: number; saves?: number; shares?: number; watchTimeSec?: number; profileVisits?: number;
  follows?: number; retentionPct?: number; skipRatePct?: number; durationSec?: number;
  raw: unknown;
}

function num(o: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = k.split('.').reduce<unknown>((x, part) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[part] : undefined), o);
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  }
  return undefined;
}

/** Tolerant parser: Metricool field names differ between post types and API versions. */
export function parsePostMetrics(json: unknown, kind: ProviderPostMetrics['kind']): ProviderPostMetrics[] {
  const arr = Array.isArray(json) ? json : ((json as { data?: unknown })?.data as unknown[]) ?? [];
  if (!Array.isArray(arr)) return [];
  return (arr as Record<string, unknown>[]).map((p) => {
    // field names verified against Metricool's analytics catalogue (posts/reels: timestamp, saved, views, averageWatchTime, retention, reelsSkipRate…)
    const pub = (p.timestamp ?? p.publishedAt ?? p.published ?? p.date ?? p.created) as unknown;
    const dt = typeof pub === 'number' ? new Date(pub > 1e12 ? pub : pub * 1000).toISOString() : typeof pub === 'string' ? pub : (pub as { dateTime?: string } | null)?.dateTime;
    const d = dt ? new Date(dt) : undefined;
    return {
      kind, raw: p,
      url: (p.url ?? p.permalink ?? p.link) as string | undefined, // stories use `permalink`
      postId: (p.postId ?? p.id ?? p.mediaId)?.toString(),
      publishedAt: d && !Number.isNaN(d.getTime()) ? d : undefined,
      reach: num(p, 'reach', 'reachTotal'),
      views: num(p, 'views', 'videoViews', 'plays', 'impressions', 'impressionsTotal'),
      likes: num(p, 'likes', 'likeCount'),
      comments: num(p, 'comments', 'commentsCount'),
      saves: num(p, 'saved', 'saves'),
      shares: num(p, 'shares', 'sharesCount'),
      watchTimeSec: num(p, 'averageWatchTime', 'avgWatchTime', 'watchTime'),
      profileVisits: num(p, 'profileVisits', 'profile_visits'),
      follows: num(p, 'follows'),
      retentionPct: num(p, 'retention'),
      skipRatePct: num(p, 'reelsSkipRate', 'skipRate'),
      durationSec: num(p, 'durationSeconds', 'duration'),
    };
  });
}

const NETWORK: Record<SocialPlatform, string> = {
  instagram: 'instagram', facebook: 'facebook', tiktok: 'tiktok', threads: 'threads', youtube: 'youtube',
  pinterest: 'pinterest', linkedin: 'linkedin', twitter: 'twitter', gmb: 'gmb',
};

type FetchFn = typeof fetch;

export class MetricoolAdapter implements PublishingAdapter {
  readonly name = 'metricool';
  constructor(private cfg: { token: string; userId: string; baseUrl: string; fetchImpl?: FetchFn; timeoutMs?: number }) {}

  private url(p: string, q: Record<string, string> = {}) {
    const u = new URL(this.cfg.baseUrl.replace(/\/$/, '') + p);
    u.searchParams.set('userId', this.cfg.userId);
    for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
    return u.toString();
  }

  private async req(method: string, p: string, q: Record<string, string>, body?: unknown) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs ?? 30_000);
    try {
      const res = await (this.cfg.fetchImpl ?? fetch)(this.url(p, q), {
        method, signal: ctrl.signal,
        headers: { 'X-Mc-Auth': this.cfg.token, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let json: unknown = null; try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 2000) }; }
      return { status: res.status, json, headers: res.headers };
    } finally { clearTimeout(t); }
  }

  /** Read-only analytics for one brand and time range (Bahrain local dates). */
  async listPostMetrics(brandId: string, kind: ProviderPostMetrics['kind'], from: Date, to: Date, timezone = 'Asia/Bahrain'): Promise<ProviderPostMetrics[]> {
    const fmt = (d: Date) => localDateTime(d, timezone).slice(0, 19);
    const r = await this.req('GET', ENDPOINTS.analytics(kind), { blogId: brandId, from: fmt(from), to: fmt(to), timezone });
    if (r.status === 401 || r.status === 403) throw new Error(`Metricool رفض الوصول إلى التحليلات (${r.status}) — قد لا تتيح خطتك ذلك.`);
    if (r.status !== 200) throw new Error(`استجابة تحليلات غير متوقعة من Metricool (${r.status}).`);
    return parsePostMetrics(r.json, kind);
  }

  /** Read-only competitor analytics; returns raw rows for the tolerant parsers in lib/competitors. */
  async listCompetitorRows(brandId: string, from: Date, to: Date, timezone = 'Asia/Bahrain') {
    const q = { blogId: brandId, from: localDateTime(from, timezone).slice(0, 19), to: localDateTime(to, timezone).slice(0, 19), timezone };
    const rows = (json: unknown) => (Array.isArray(json) ? json : ((json as { data?: unknown[] })?.data ?? [])) as Record<string, unknown>[];
    const get = async (part: '' | '/posts' | '/reels') => {
      const r = await this.req('GET', ENDPOINTS.competitors(part), q);
      if (r.status === 401 || r.status === 403) throw new Error(`Metricool رفض الوصول لبيانات المنافسين (${r.status}) — قد لا تتيح خطتك ذلك.`);
      if (r.status !== 200) throw new Error(`استجابة غير متوقعة لبيانات المنافسين (${r.status}).`);
      return rows(r.json);
    };
    const [competitors, posts, reels] = [await get(''), await get('/posts').catch(() => []), await get('/reels').catch(() => [])];
    return { competitors, posts, reels };
  }

  async verify() {
    try {
      const r = await this.req('GET', ENDPOINTS.profiles, {});
      if (r.status === 200) return { ok: true, message: `تم التحقق من Metricool — ${(this.parseProfiles(r.json)).length} علامة تجارية.` };
      if (r.status === 401 || r.status === 403) return { ok: false, message: `رفض Metricool بيانات الاعتماد (${r.status}). تحقق من الرمز ورقم المستخدم وأن خطتك تتيح الوصول إلى API.` };
      return { ok: false, message: `استجابة غير متوقعة من Metricool (${r.status}).` };
    } catch (e) { return { ok: false, message: `تعذر الاتصال بـ Metricool: ${(e as Error).message}` }; }
  }

  parseProfiles(json: unknown): ProviderProfile[] {
    const arr = Array.isArray(json) ? json : (json as { data?: unknown[] })?.data ?? [];
    return (arr as Record<string, unknown>[]).map((b) => {
      const networks: ProviderProfile['networks'] = [];
      // Metricool returns networks either as top-level fields ("instagram": "handle") or nested
      // under networksData ("networksData": {"instagramData": "handle"}). Support both.
      const nd = (b.networksData ?? {}) as Record<string, unknown>;
      const val = (...keys: string[]) => {
        for (const k of keys) {
          for (const v of [b[k], nd[k], nd[`${k}Data`]]) {
            if (v !== undefined && v !== null && v !== '' && v !== false) return typeof v === 'object' ? JSON.stringify(v) : String(v);
          }
        }
        return null;
      };
      const add = (network: SocialPlatform, v: string | null, asId = false) => { if (v) networks.push(asId ? { network, id: v } : { network, handle: v }); };
      add('instagram', val('instagram'));
      add('gmb', val('gbp', 'gmb', 'googleBusiness', 'googleMyBusiness')); // Metricool: networksData.gbpData = "accounts/…/locations/…"
      add('facebook', val('facebookPageId', 'facebook'), true);
      add('tiktok', val('tiktok'));
      add('threads', val('threads'));
      add('youtube', val('youtube'), true);
      add('pinterest', val('pinterest'));
      add('linkedin', val('linkedinCompany', 'linkedin'), true);
      add('twitter', val('twitter'));
      return { brandId: String(b.id ?? b.blogId), label: String(b.label ?? b.title ?? b.id), timezone: b.timezone as string | undefined, networks, raw: { id: b.id, label: b.label } };
    });
  }

  async listProfiles() {
    const r = await this.req('GET', ENDPOINTS.profiles, {});
    if (r.status !== 200) throw new Error(`Metricool profiles request failed (${r.status})`);
    return this.parseProfiles(r.json);
  }

  buildBody(req: PublishRequest) {
    const nets = [...new Set(req.networks.map((n) => NETWORK[n]))];
    const isVideo = req.format === 'REEL_VIDEO';
    // Stories carry no caption: when EVERY target is a story, Metricool rejects/ignores text.
    const storyOnly = req.format === 'IMAGE_STORY' && nets.every((n) => n === 'instagram' || n === 'facebook');
    const body: Record<string, unknown> = {
      publicationDate: { dateTime: localDateTime(req.publishAt, req.timezone), timezone: req.timezone },
      // GBP 'photo' (video to the profile gallery) carries no text of its own
      text: storyOnly || (isVideo && nets.length === 1 && nets[0] === 'gmb') ? '' : req.text,
      providers: nets.map((network) => ({ network })),
      media: req.mediaUrls,
      autoPublish: true,
      draft: false,
      shortener: false,
      firstCommentText: storyOnly ? '' : (req.firstComment ?? ''),
      descendants: [],
      mediaAltText: req.altText ? req.mediaUrls.map(() => req.altText!.slice(0, 1000)) : [],
      smartLinkData: { ids: [] },
    };
    const title = req.title ?? req.text.slice(0, 90);
    for (const net of nets) {
      if (net === 'instagram') {
        const ig: Record<string, unknown> = { type: isVideo ? 'REEL' : req.format === 'IMAGE_STORY' ? 'STORY' : 'POST', showReelOnFeed: true, isAiGenerated: req.aiGenerated };
        if (isVideo && req.instagramAudio) ig.audioConfiguration = { audioId: req.instagramAudio };
        body.instagramData = ig;
      }
      if (net === 'facebook') body.facebookData = { type: isVideo ? 'REEL' : req.format === 'IMAGE_STORY' ? 'STORY' : 'POST' };
      if (net === 'tiktok') body.tiktokData = { privacyOption: 'PUBLIC_TO_EVERYONE', isAigc: req.aiGenerated && isVideo, commercialContentOwnBrand: true, title: title.slice(0, 90) };
      if (net === 'youtube') body.youtubeData = { title: [...title].slice(0, 100).join(''), type: 'short', privacy: 'public', madeForKids: false, isAiGeneratedContent: req.aiGenerated, tags: (req.tags ?? []).slice(0, 15), category: 'PEOPLE_BLOGS' };
      // Google Business Profile: "publication" = text update (+image); video can only go to the gallery as "photo" (no text)
      if (net === 'gmb') body.gmbData = { type: isVideo ? 'photo' : 'publication' };
      if (net === 'pinterest') body.pinterestData = { pinTitle: [...title].slice(0, 100).join(''), isAiGenerated: req.aiGenerated, ...(req.pinterestBoard ? { boardId: req.pinterestBoard } : {}), ...(req.link ? { pinLink: req.link } : {}) };
      if (net === 'linkedin') body.linkedinData = { type: 'post' };
      if (net === 'threads') body.threadsData = {};
      if (net === 'twitter') body.twitterData = { tags: [] };
    }
    const thumbNets = ['instagram', 'tiktok', 'youtube', 'linkedin', 'facebook'];
    if (isVideo && req.thumbnailUrl && nets.some((n) => thumbNets.includes(n))) body.videoThumbnailUrl = req.thumbnailUrl;
    return body;
  }

  private extractId(json: unknown): string | null {
    const j = json as Record<string, unknown> | null;
    const d = (j?.data ?? j) as Record<string, unknown> | null;
    const id = d?.id ?? d?.postId ?? (Array.isArray(d) ? (d[0] as Record<string, unknown>)?.id : undefined);
    return id !== undefined && id !== null ? String(id) : null;
  }

  async submit(req: PublishRequest): Promise<SubmitOutcome> {
    let r;
    try { r = await this.req('POST', ENDPOINTS.posts, { blogId: req.providerBrandId }, this.buildBody(req)); }
    catch (e) {
      // Timeout / connection reset AFTER sending: the post may exist. Never blindly retry.
      return { kind: 'UNCERTAIN', message: `network: ${(e as Error).message}` };
    }
    if (r.status === 429) {
      const ra = Number(r.headers.get('retry-after') ?? 60);
      return { kind: 'RATE_LIMITED', retryAfterSec: Number.isFinite(ra) ? ra : 60, httpStatus: 429, message: 'rate limited' };
    }
    if (r.status >= 200 && r.status < 300) {
      const id = this.extractId(r.json);
      if (!id) return { kind: 'UNCERTAIN', message: 'provider returned success without a post id', httpStatus: r.status };
      return { kind: 'ACCEPTED', providerPostId: id, providerStatus: 'PENDING', raw: r.json, httpStatus: r.status };
    }
    if (r.status >= 400 && r.status < 500) return { kind: 'REJECTED', httpStatus: r.status, message: JSON.stringify(r.json).slice(0, 500), raw: r.json };
    return { kind: 'UNCERTAIN', message: `provider ${r.status}`, httpStatus: r.status };
  }

  /** Maps Metricool provider status → our verified status. Only an explicit PUBLISHED counts. */
  parseStatus(json: unknown, providerPostId: string): RemoteStatus {
    const j = json as Record<string, unknown> | null;
    const p = (j?.data ?? j) as Record<string, unknown> | null;
    if (!p) return { kind: 'NOT_FOUND' };
    const providers = (p.providers as Record<string, unknown>[] | undefined) ?? [];
    const statuses = providers.map((x) => String(x.status ?? '').toUpperCase());
    const publicUrl = providers.map((x) => x.publicUrl as string | undefined).find(Boolean);
    if (statuses.length && statuses.every((s) => s === 'PUBLISHED')) return { kind: 'PUBLISHED', providerPostId, publicUrl, raw: p };
    if (statuses.some((s) => s === 'ERROR' || s === 'FAILED')) {
      const msg = providers.map((x) => x.detailedStatus ?? x.error).filter(Boolean).join('; ') || 'provider reported an error';
      return { kind: 'ERROR', providerPostId, message: String(msg), raw: p };
    }
    return { kind: 'PENDING', providerPostId, raw: p };
  }

  async getStatus(brandId: string, providerPostId: string): Promise<RemoteStatus> {
    const r = await this.req('GET', ENDPOINTS.post(providerPostId), { blogId: brandId });
    if (r.status === 404) return { kind: 'NOT_FOUND' };
    if (r.status !== 200) throw new Error(`Metricool status request failed (${r.status})`);
    return this.parseStatus(r.json, providerPostId);
  }

  async listScheduled(brandId: string, from: Date, to: Date, timezone: string) {
    const r = await this.req('GET', ENDPOINTS.posts, { blogId: brandId, start: localDateTime(from, timezone), end: localDateTime(to, timezone), timezone });
    if (r.status !== 200) throw new Error(`Metricool list request failed (${r.status})`);
    const list = ((r.json as { data?: unknown[] })?.data ?? r.json ?? []) as Record<string, unknown>[];
    if (!Array.isArray(list)) return [];
    return list.map((p) => {
      const pd = p.publicationDate as { dateTime?: string; timezone?: string } | undefined;
      const prov = ((p.providers as { status?: string }[] | undefined) ?? [])[0];
      const ig = p.instagramData as { type?: string } | undefined;
      return {
        id: String(p.id), at: pd?.dateTime ? fromZonedTime(pd.dateTime, pd.timezone ?? timezone) : null,
        text: String(p.text ?? ''), media: ((p.media as string[] | undefined) ?? []).map(String), type: ig?.type ?? 'POST', status: prov?.status ?? 'UNKNOWN',
      };
    });
  }

  async findExisting(req: PublishRequest) {
    const from = new Date(req.publishAt.getTime() - 3600_000), to = new Date(req.publishAt.getTime() + 3600_000);
    const r = await this.req('GET', ENDPOINTS.posts, { blogId: req.providerBrandId, start: localDateTime(from, req.timezone), end: localDateTime(to, req.timezone), timezone: req.timezone });
    if (r.status !== 200) throw new Error(`Metricool list request failed (${r.status})`);
    const list = ((r.json as { data?: unknown[] })?.data ?? r.json ?? []) as Record<string, unknown>[];
    if (!Array.isArray(list)) return null;
    const want = req.mediaUrls[0]?.split('?')[0];
    const match = list.find((p) => {
      const media = (p.media as string[] | undefined) ?? [];
      const sameMedia = want ? media.some((m) => String(m).split('?')[0] === want) : false;
      const sameText = String(p.text ?? '').trim() === req.text.trim();
      return sameMedia || sameText;
    });
    return match ? { providerPostId: String(match.id), raw: match } : null;
  }
}
