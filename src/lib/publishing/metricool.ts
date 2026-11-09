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
};

const NETWORK: Record<SocialPlatform, string> = {
  instagram: 'instagram', facebook: 'facebook', tiktok: 'tiktok', threads: 'threads', youtube: 'youtube',
  pinterest: 'pinterest', linkedin: 'linkedin', twitter: 'twitter',
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
      const has = (k: string) => b[k] !== undefined && b[k] !== null && b[k] !== '';
      if (has('instagram')) networks.push({ network: 'instagram', handle: String(b.instagram) });
      if (has('facebookPageId') || has('facebook')) networks.push({ network: 'facebook', id: String(b.facebookPageId ?? b.facebook) });
      if (has('tiktok')) networks.push({ network: 'tiktok', handle: String(b.tiktok) });
      if (has('threads')) networks.push({ network: 'threads', handle: String(b.threads) });
      if (has('youtube')) networks.push({ network: 'youtube', id: String(b.youtube) });
      if (has('pinterest')) networks.push({ network: 'pinterest', handle: String(b.pinterest) });
      if (has('linkedinCompany') || has('linkedin')) networks.push({ network: 'linkedin', id: String(b.linkedinCompany ?? b.linkedin) });
      if (has('twitter')) networks.push({ network: 'twitter', handle: String(b.twitter) });
      return { brandId: String(b.id ?? b.blogId), label: String(b.label ?? b.title ?? b.id), timezone: b.timezone as string | undefined, networks, raw: { id: b.id, label: b.label } };
    });
  }

  async listProfiles() {
    const r = await this.req('GET', ENDPOINTS.profiles, {});
    if (r.status !== 200) throw new Error(`Metricool profiles request failed (${r.status})`);
    return this.parseProfiles(r.json);
  }

  buildBody(req: PublishRequest) {
    const net = NETWORK[req.network];
    const isVideo = req.format === 'REEL_VIDEO';
    const body: Record<string, unknown> = {
      publicationDate: { dateTime: localDateTime(req.publishAt, req.timezone), timezone: req.timezone },
      text: req.text,
      providers: [{ network: net }],
      media: req.mediaUrls,
      autoPublish: true,
      draft: false,
      shortener: false,
      firstCommentText: '',
      descendants: [],
      mediaAltText: [],
      smartLinkData: { ids: [] },
    };
    if (net === 'instagram') body.instagramData = { type: isVideo ? 'REEL' : req.format === 'IMAGE_STORY' ? 'STORY' : 'POST', showReelOnFeed: true, isAiGenerated: req.aiGenerated };
    if (net === 'facebook') body.facebookData = { type: isVideo ? 'REEL' : req.format === 'IMAGE_STORY' ? 'STORY' : 'POST' };
    if (net === 'tiktok') body.tiktokData = { privacyOption: 'PUBLIC_TO_EVERYONE', isAigc: req.aiGenerated && isVideo, commercialContentOwnBrand: true };
    if (net === 'youtube') body.youtubeData = { title: req.title ?? req.text.slice(0, 90), type: 'short', privacy: 'public', madeForKids: false, isAiGeneratedContent: req.aiGenerated };
    if (net === 'pinterest') body.pinterestData = { pinTitle: req.title ?? req.text.slice(0, 90), isAiGenerated: req.aiGenerated };
    if (net === 'linkedin') body.linkedinData = { type: 'post' };
    if (net === 'threads') body.threadsData = {};
    if (net === 'twitter') body.twitterData = { tags: [] };
    if (isVideo && req.thumbnailUrl && ['instagram', 'tiktok', 'youtube', 'linkedin', 'facebook'].includes(net)) body.videoThumbnailUrl = req.thumbnailUrl;
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
