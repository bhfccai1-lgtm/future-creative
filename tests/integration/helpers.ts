import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db';
import { redis } from '@/lib/queue/connection';
import { DEFAULT_ROLES } from '@/lib/auth/rbac';
import { DEFAULT_LOCATIONS } from '@/lib/business';
import { CATEGORIES, PRODUCTS } from '@/lib/catalog/seed-data';
import { uploadLogo, approveLogo } from '@/lib/brand/logo';
import { updateSettings, SettingsSchema, type Settings } from '@/lib/settings';
import { setEnqueueImpl } from '@/lib/queue/queues';
import { setAiProviderOverride } from '@/lib/ai';
import { setPublishingAdapterOverride } from '@/lib/publishing/registry';
import { DryRunProvider } from '@/lib/ai/dry-run-provider';
import { AiProviderError, type AiProvider, type BriefRequest } from '@/lib/ai/types';
import type { PublishingAdapter, PublishRequest, RemoteStatus, SubmitOutcome } from '@/lib/publishing/types';

/** position of FakeAiProvider's picture within the current test (reset by resetDb) — see fakeScene */
let fakeSceneSeq = 0;

export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  await redis().flushdb();
  setAiProviderOverride(null); setPublishingAdapterOverride(null);
  fakeSceneSeq = 0;
}

export const captured = { generate: [] as { data: unknown; id: string }[], publish: [] as { id: string; delay: number }[] };
export function captureQueues() {
  captured.generate.length = 0; captured.publish.length = 0;
  setEnqueueImpl({
    generate: (async (data: unknown, id: string) => { captured.generate.push({ data, id }); return null; }) as never,
    publish: (async (id: string, delay = 0) => { captured.publish.push({ id, delay }); return null; }) as never,
  });
}

export const logoPng = () => sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><circle cx="200" cy="200" r="170" fill="#d4af37"/><rect x="400" y="120" width="360" height="160" rx="24" fill="#0b1730"/></svg>')).png().toBuffer();

export async function seedBase(opts: { accounts?: number; connected?: boolean; settings?: (s: Settings) => Settings; productCount?: number; autoRenderMode?: 'auto' | 'layered' | 'ai_full'; imageGate?: boolean } = {}) {
  for (const [name, permissions] of Object.entries(DEFAULT_ROLES)) await prisma.role.create({ data: { name, permissions } });
  const admin = await prisma.user.create({ data: { email: 'admin@test.bh', name: 'Admin', passwordHash: 'x', role: { connect: { name: 'ADMIN' } } } });
  const business = await prisma.business.create({ data: { nameAr: 'مطبعة إبداع المستقبل', nameEn: 'Future Creative Printing', locations: DEFAULT_LOCATIONS } });
  for (const c of CATEGORIES) await prisma.productCategory.create({ data: { slug: c.slug, nameAr: c.ar, nameEn: c.en } });
  const cats = Object.fromEntries((await prisma.productCategory.findMany()).map((c) => [c.slug, c.id]));
  for (const p of PRODUCTS.slice(0, opts.productCount ?? 6)) {
    await prisma.product.create({ data: { slug: p.slug, categoryId: cats[p.category], name: p.name, titleAr: p.ar, titleEn: p.en, titleMl: p.ml, targetAudience: p.audience, occasions: p.occasions, visualGuidelines: p.visual, recommendedMessages: p.msg, relevantAccountTags: p.tags } });
  }
  const logo = await uploadLogo(business.id, await logoPng(), 'test');
  await approveLogo(logo.id, 'test');
  // tests exercise the layered path unless they opt in to the production default ('auto' method)
  // the picture quality gate is exercised by its own tests (the fake provider's pictures are flat placeholders)
  const layered = (x: Settings) => ({ ...x, ai: { ...x.ai, autoRenderMode: opts.autoRenderMode ?? 'layered', imageQualityGate: opts.imageGate ?? false } }) as Settings;
  await updateSettings((s) => layered(opts.settings ? opts.settings(SettingsSchema.parse({})) : s));
  const accounts = [];
  for (let i = 0; i < (opts.accounts ?? 2); i++) {
    const a = await prisma.socialAccount.create({ data: { businessId: business.id, name: `Account ${i + 1}`, platform: 'instagram', language: i % 3 === 1 ? 'en' : 'ar', publishFormat: 'IMAGE_STORY', publishWindowStart: '00:00', publishWindowEnd: '23:59' } });
    if (opts.connected !== false) await prisma.socialConnection.create({ data: { accountId: a.id, provider: 'metricool', providerBrandId: `${1000 + i}`, providerNetwork: 'instagram', status: 'CONNECTED', canPublish: true, lastVerifiedAt: new Date() } });
    accounts.push(a);
  }
  return { admin, business, accounts };
}

/** Non-dry-run AI double: deterministic content, configurable failures. Counts as "real" for QC purposes. */
export class FakeAiProvider implements AiProvider {
  readonly name = 'fake-ai';
  readonly isDryRun = false;
  inner = new DryRunProvider();
  briefCalls = 0; sceneCalls = 0; lastScenePrompt = ''; lastReferences: Buffer[] | undefined; lastCopy = ''; readTextResult: string | null = null;
  failBrief: AiProviderError[] = []; failScene: AiProviderError[] = [];
  async generateBrief(req: BriefRequest) {
    this.briefCalls++;
    const f = this.failBrief.shift(); if (f) throw f;
    const r = await this.inner.generateBrief(req);
    this.lastCopy = [r.brief.headline, r.brief.badge, r.brief.supportingCopy ?? ''].filter(Boolean).join('\n');
    return { ...r, model: 'fake-text', usage: { inputTokens: 2000, outputTokens: 600 } };
  }
  async describeStyle() { return { text: 'Deep navy and glossy gold palette, warm cinematic light, gold 3D lettering.', usage: { inputTokens: 900, outputTokens: 120 }, model: 'fake-vision' }; }
  async readText() { return { text: this.readTextResult ?? this.lastCopy, /* default: the drawn text reads back correctly */ usage: { inputTokens: 300, outputTokens: 40 }, model: 'fake-vision' }; }
  async suggestIdeas(req: BriefRequest, model: string, count: number) { return { ...(await this.inner.suggestIdeas(req, model, count)), model: 'fake-text' }; }
  async generateScene(prompt: string, opts: { model: string; quality: 'low' | 'medium' | 'high'; size: '1024x1536' | '1024x1024' | '1536x1024'; seedHint: string; references?: Buffer[]; background?: 'transparent' | 'opaque' }) {
    this.sceneCalls++; this.lastScenePrompt = prompt; this.lastReferences = opts.references;
    const f = this.failScene.shift(); if (f) throw f;
    // seeded by the call's position in the test, not by `seedHint` (which carries random ids and the clock)
    return { png: await fakeScene(opts.size, `fake-scene-${++fakeSceneSeq}`, opts.background), model: 'fake-image' };
  }
}

/**
 * The fake provider's picture: varied per seed (so duplicate detection still tells ads apart) but CLEAN BY CONSTRUCTION,
 * whatever the seed. Seeds carry random ids and `Date.now()`, so a picture whose quality depended on the seed made tests
 * flaky: the dry-run preview's soft, semi-transparent shapes now and then scored «soft» (sharpness < 0.2 → an extra
 * image call from the quality gate), and its light cream / gold panels could land under the light headline text
 * (contrast < 3:1 → QC blocker → not publishable). Here:
 *  - every shape is opaque with crisp edges (sharp), and every colour is dark (light text always reads ≥ 3:1);
 *  - the top and bottom bands, where the logo and the phone numbers sit, stay one flat colour;
 *  - `background: 'transparent'` returns a cut-out with a clear margin, as a real image model does;
 *  - FakeAiProvider seeds it with the call's position in the test, so every run of a test sees the same pictures.
 * Tests that need a faulty picture script it explicitly (readText answers, failScene, their own generateScene).
 */
export async function fakeScene(size: string, seedHint: string, background?: 'transparent' | 'opaque') {
  const [w, h] = size.split('x').map(Number);
  const hash = (s: string) => parseInt(createHash('sha256').update(s).digest('hex').slice(0, 8), 16);
  const n = hash(seedHint), hue = n % 360;
  const cut = background === 'transparent';
  // shapes live in the middle band (opaque) or inside a centred margin (cut-out)
  const x0 = cut ? w * 0.18 : 0, x1 = cut ? w * 0.82 : w, y0 = cut ? h * 0.18 : h * 0.3, y1 = cut ? h * 0.82 : h * 0.72;
  const shapes = Array.from({ length: 9 }, (_, i) => {
    const k = hash(`${seedHint}:${i}`);
    const sw = (x1 - x0) * (0.12 + ((k >> 3) % 30) / 100), sh = (y1 - y0) * (0.12 + ((k >> 9) % 30) / 100);
    const x = x0 + ((k >> 15) % 1000) / 1000 * (x1 - x0 - sw), y = y0 + ((k >> 5) % 1000) / 1000 * (y1 - y0 - sh);
    const fill = `hsl(${(hue + i * 37) % 360},60%,${14 + (i % 4) * 5}%)`; // lightness 14–29 %: always dark
    return i % 2 ? `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${sw.toFixed(1)}" height="${sh.toFixed(1)}" fill="${fill}"/>`
      : `<ellipse cx="${(x + sw / 2).toFixed(1)}" cy="${(y + sh / 2).toFixed(1)}" rx="${(sw / 2).toFixed(1)}" ry="${(sh / 2).toFixed(1)}" fill="${fill}"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${cut ? '' : `<rect width="100%" height="100%" fill="#0b1730"/>`}${shapes}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Publishing double. Test results from this adapter are NOT evidence of a real social-media post. */
export class FakeAdapter implements PublishingAdapter {
  readonly name = 'fake';
  submits: PublishRequest[] = [];
  outcomes: SubmitOutcome[] = [];
  existing: { providerPostId: string } | null = null;
  status: RemoteStatus = { kind: 'PENDING', providerPostId: 'p1', raw: {} };
  submitDelayMs = 0;
  async verify() { return { ok: true, message: 'fake' }; }
  async listProfiles() { return []; }
  async submit(req: PublishRequest): Promise<SubmitOutcome> {
    this.submits.push(req);
    if (this.submitDelayMs) await new Promise((r) => setTimeout(r, this.submitDelayMs));
    return this.outcomes.shift() ?? { kind: 'ACCEPTED', providerPostId: `post-${this.submits.length}`, providerStatus: 'PENDING', raw: {}, httpStatus: 200 };
  }
  async getStatus() { return this.status; }
  async findExisting() { return this.existing ? { providerPostId: this.existing.providerPostId, raw: {} } : null; }
}
