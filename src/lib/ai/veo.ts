import sharp from 'sharp';

/**
 * Google Gemini API — Veo video generation (image-to-video, 9:16, native audio on Veo 3.x).
 *
 * Endpoint: POST {base}/models/{model}:predictLongRunning → long-running operation → poll {base}/{operation}
 * until done → download response.generateVideoResponse.generatedSamples[0].video.uri with the API key.
 * Model ids and prices change often: both are settings (dashboard), not constants. The request is sent in the
 * documented REST shape; the first-frame image falls back to the alternative field format if the API rejects it.
 */
export const VEO_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const VEO_MODELS = ['veo-3.1-fast-generate-preview', 'veo-3.1-generate-preview'] as const;

export type VeoErrorCode = 'AUTH' | 'QUOTA' | 'SAFETY' | 'BAD_REQUEST' | 'TIMEOUT' | 'NETWORK' | 'NO_VIDEO';
export class VeoError extends Error {
  constructor(public code: VeoErrorCode, message: string, public httpStatus?: number) { super(message); this.name = 'VeoError'; }
}

export interface VeoRequest {
  prompt: string;
  /** First frame (our AI product scene) — keeps the real product design in the video. */
  image?: Buffer;
  durationSec?: 4 | 6 | 8;
  resolution?: '720p' | '1080p';
  negativePrompt?: string;
}
export interface VeoResult { mp4: Buffer; model: string; operation: string; durationSec: number }

type FetchFn = typeof fetch;

export class VeoProvider {
  readonly name = 'gemini-veo';
  constructor(private cfg: { apiKey: string; model: string; fetchImpl?: FetchFn; pollMs?: number; timeoutMs?: number; base?: string }) {}

  private get base() { return this.cfg.base ?? VEO_BASE; }
  private async call(method: string, url: string, body?: unknown) {
    let res: Response;
    try {
      res = await (this.cfg.fetchImpl ?? fetch)(url, { method, headers: { 'x-goog-api-key': this.cfg.apiKey, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    } catch (e) { throw new VeoError('NETWORK', `تعذر الاتصال بـ Gemini: ${(e as Error).message}`); }
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text.slice(0, 500) }; }
    return { status: res.status, json };
  }
  private fail(status: number, json: Record<string, unknown>): never {
    const msg = String((json.error as { message?: string } | undefined)?.message ?? json.raw ?? `HTTP ${status}`).slice(0, 400);
    if (status === 401 || status === 403) throw new VeoError('AUTH', `رفض Gemini المفتاح أو الصلاحية (${status}): ${msg}`, status);
    if (status === 429) throw new VeoError('QUOTA', `تجاوزت حصة Gemini/Veo (${status}): ${msg}`, status);
    if (/safety|blocked|responsible ai|rai/i.test(msg)) throw new VeoError('SAFETY', `رفض Veo الطلب لأسباب أمان المحتوى: ${msg}`, status);
    throw new VeoError('BAD_REQUEST', `طلب Veo غير مقبول (${status}): ${msg}`, status);
  }

  /** Verifies the key and that the configured Veo model is available to it (one read-only call). */
  async verify(): Promise<{ ok: boolean; message: string; models: string[] }> {
    try {
      const r = await this.call('GET', `${this.base}/models?pageSize=1000`);
      if (r.status !== 200) this.fail(r.status, r.json);
      const models = ((r.json.models as { name: string }[] | undefined) ?? []).map((m) => m.name.replace(/^models\//, '')).filter((n) => n.startsWith('veo'));
      const ok = models.includes(this.cfg.model);
      return { ok, models, message: ok ? `المفتاح صالح والنموذج ${this.cfg.model} متاح.` : models.length ? `المفتاح صالح لكن النموذج ${this.cfg.model} غير متاح لحسابك. المتاح: ${models.join('، ')}` : 'المفتاح صالح لكن لا تتوفر نماذج Veo لحسابك (قد تتطلب خطة مدفوعة/فوترة مفعّلة).' };
    } catch (e) { return { ok: false, models: [], message: (e as Error).message }; }
  }

  async generateVideo(req: VeoRequest): Promise<VeoResult> {
    const durationSec = req.durationSec ?? 8;
    const parameters: Record<string, unknown> = { aspectRatio: '9:16', durationSeconds: durationSec, ...(req.resolution ? { resolution: req.resolution } : {}), ...(req.negativePrompt ? { negativePrompt: req.negativePrompt } : {}) };
    // first frame cropped to 9:16 so Veo does not letterbox it
    const frame = req.image ? await sharp(req.image).resize(720, 1280, { fit: 'cover' }).png().toBuffer() : null;
    const shapes = frame ? [
      { prompt: req.prompt, image: { bytesBase64Encoded: frame.toString('base64'), mimeType: 'image/png' } },
      { prompt: req.prompt, image: { inlineData: { mimeType: 'image/png', data: frame.toString('base64') } } },
    ] : [{ prompt: req.prompt }];
    let start: { status: number; json: Record<string, unknown> } | null = null;
    for (const instance of shapes) {
      start = await this.call('POST', `${this.base}/models/${encodeURIComponent(this.cfg.model)}:predictLongRunning`, { instances: [instance], parameters });
      if (start.status === 200) break;
      const msg = JSON.stringify(start.json);
      if (!(start.status === 400 && /image|struct|inlineData|bytesBase64Encoded|unknown name/i.test(msg))) break; // only retry for image-format complaints
    }
    if (!start || start.status !== 200) this.fail(start?.status ?? 0, start?.json ?? {});
    const opName = String(start!.json.name ?? '');
    if (!opName) throw new VeoError('BAD_REQUEST', 'لم يُرجع Veo معرّف عملية.');

    const deadline = Date.now() + (this.cfg.timeoutMs ?? 8 * 60_000);
    let op: Record<string, unknown> = start!.json;
    while (!op.done) {
      if (Date.now() > deadline) throw new VeoError('TIMEOUT', `انتهت مهلة توليد الفيديو (${opName}).`);
      await new Promise((r) => setTimeout(r, this.cfg.pollMs ?? 10_000));
      const p = await this.call('GET', `${this.base}/${opName}`);
      if (p.status !== 200) this.fail(p.status, p.json);
      op = p.json;
    }
    if (op.error) this.fail(400, { error: op.error });
    const resp = (op.response ?? {}) as Record<string, unknown>;
    const gvr = (resp.generateVideoResponse ?? resp) as Record<string, unknown>;
    const filtered = Number(gvr.raiMediaFilteredCount ?? 0);
    const sample = ((gvr.generatedSamples ?? gvr.videos ?? []) as Record<string, unknown>[])[0];
    const video = (sample?.video ?? sample) as { uri?: string; gcsUri?: string; bytesBase64Encoded?: string } | undefined;
    if (!video?.uri && !video?.bytesBase64Encoded) {
      const reasons = (gvr.raiMediaFilteredReasons as string[] | undefined)?.join('؛ ');
      throw new VeoError(filtered || reasons ? 'SAFETY' : 'NO_VIDEO', filtered || reasons ? `حجب Veo الفيديو الناتج (فلتر الأمان): ${reasons ?? ''}` : 'اكتمل الطلب بدون فيديو.');
    }
    let mp4: Buffer;
    if (video.bytesBase64Encoded) mp4 = Buffer.from(video.bytesBase64Encoded, 'base64');
    else {
      let res: Response;
      try { res = await (this.cfg.fetchImpl ?? fetch)(video.uri!, { headers: { 'x-goog-api-key': this.cfg.apiKey }, redirect: 'follow' }); }
      catch (e) { throw new VeoError('NETWORK', `تعذر تنزيل الفيديو: ${(e as Error).message}`); }
      if (!res.ok) throw new VeoError(res.status === 403 || res.status === 401 ? 'AUTH' : 'NO_VIDEO', `تعذر تنزيل الفيديو (${res.status}).`, res.status);
      mp4 = Buffer.from(await res.arrayBuffer());
    }
    if (mp4.length < 1000) throw new VeoError('NO_VIDEO', 'ملف الفيديو المستلم فارغ أو تالف.');
    return { mp4, model: this.cfg.model, operation: opName, durationSec };
  }
}

/** Prompt for a product reel: fast reveal in the first second (hook), product unchanged, no text. */
export function veoPrompt(sceneDescription: string, style: string) {
  return [
    'Vertical 9:16 premium commercial product video for Instagram Reels, starting from the provided first frame.',
    'Second 0–1: quick dynamic camera move that reveals the product (hook). Then a smooth cinematic push-in with gentle parallax and a soft light sweep across the printed surface.',
    'Keep the product, its shape and its printed illustration exactly as in the first frame — sharp, centred and fully visible. Natural subtle motion in the props and background only.',
    'No text, letters, numbers, subtitles, logos or watermarks anywhere. No people\'s faces.',
    'Ambient sound only: soft, warm background music and gentle room tone, no speech.',
    `Scene: ${sceneDescription}`,
    `Style: ${style}`,
  ].join(' ');
}
export const VEO_NEGATIVE = 'text, letters, words, captions, subtitles, logo, watermark, brand name, distorted product, warped print, extra objects covering the product, faces';
