/**
 * Official Instagram Graph API (no scraping): the owner's Meta token (system user / page token with
 * instagram_basic, instagram_manage_comments, pages_show_list, pages_read_engagement) reads comments on OUR posts
 * and posts a reply / hides spam ONLY when a person clicks.
 */
type FetchFn = typeof fetch;
export interface IgAccount { igId: string; username: string }
export interface IgComment { id: string; text: string; username?: string; timestamp?: string; likeCount?: number; mediaId: string; permalink?: string }

export class InstagramComments {
  constructor(private o: { token: string; version?: string; fetchImpl?: FetchFn }) {}
  private async call(path: string, init: { method?: 'GET' | 'POST'; params?: Record<string, string> } = {}) {
    const u = new URL(`https://graph.facebook.com/${this.o.version ?? 'v23.0'}/${path.replace(/^\//, '')}`);
    const body = new URLSearchParams(init.params ?? {});
    if ((init.method ?? 'GET') === 'GET') for (const [k, v] of body) u.searchParams.set(k, v);
    const res = await (this.o.fetchImpl ?? fetch)(u, {
      method: init.method ?? 'GET', headers: { Authorization: `Bearer ${this.o.token}`, ...(init.method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      body: init.method === 'POST' ? body.toString() : undefined, signal: AbortSignal.timeout(20_000),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number } } & Record<string, unknown>;
    if (!res.ok || j.error) throw new Error(j.error?.message ? `Meta: ${j.error.message}` : `Meta HTTP ${res.status}`);
    return j;
  }
  /** Instagram business accounts reachable with this token (via the Facebook pages they are linked to). */
  async accounts(): Promise<IgAccount[]> {
    const j = await this.call('me/accounts', { params: { fields: 'name,instagram_business_account{id,username}', limit: '100' } });
    return ((j.data as { instagram_business_account?: { id: string; username: string } }[]) ?? [])
      .map((p) => p.instagram_business_account).filter((x): x is { id: string; username: string } => !!x?.id).map((x) => ({ igId: x.id, username: x.username }));
  }
  /** Comments on the account's posts of the last `days` days (newest posts first, bounded). */
  async recentComments(igId: string, days = 14, maxPosts = 25): Promise<IgComment[]> {
    const since = Date.now() - days * 86400_000;
    const media = ((await this.call(`${igId}/media`, { params: { fields: 'id,permalink,timestamp,comments_count', limit: String(maxPosts) } })).data as { id: string; permalink?: string; timestamp?: string; comments_count?: number }[]) ?? [];
    const out: IgComment[] = [];
    for (const m of media) {
      if (!m.comments_count || (m.timestamp && Date.parse(m.timestamp) < since)) continue;
      const cs = ((await this.call(`${m.id}/comments`, { params: { fields: 'id,text,username,timestamp,like_count', limit: '50' } })).data as { id: string; text?: string; username?: string; timestamp?: string; like_count?: number }[]) ?? [];
      for (const c of cs) if (c.text?.trim()) out.push({ id: c.id, text: c.text, username: c.username, timestamp: c.timestamp, likeCount: c.like_count, mediaId: m.id, permalink: m.permalink });
    }
    return out;
  }
  async reply(commentId: string, message: string): Promise<string> {
    const j = await this.call(`${commentId}/replies`, { method: 'POST', params: { message } });
    return String(j.id ?? '');
  }
  async hide(commentId: string, hide = true) { await this.call(commentId, { method: 'POST', params: { hide: String(hide) } }); }
}
