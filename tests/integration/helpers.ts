import sharp from 'sharp';
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

export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  await redis().flushdb();
  setAiProviderOverride(null); setPublishingAdapterOverride(null);
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

export async function seedBase(opts: { accounts?: number; connected?: boolean; settings?: (s: Settings) => Settings; productCount?: number } = {}) {
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
  await updateSettings((s) => (opts.settings ? opts.settings(SettingsSchema.parse({})) : s));
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
  briefCalls = 0; sceneCalls = 0; lastScenePrompt = ''; readTextResult: string | null = null;
  failBrief: AiProviderError[] = []; failScene: AiProviderError[] = [];
  async generateBrief(req: BriefRequest) {
    this.briefCalls++;
    const f = this.failBrief.shift(); if (f) throw f;
    const r = await this.inner.generateBrief(req);
    return { ...r, model: 'fake-text', usage: { inputTokens: 2000, outputTokens: 600 } };
  }
  async readText() { return { text: this.readTextResult ?? '', usage: { inputTokens: 300, outputTokens: 40 }, model: 'fake-vision' }; }
  async suggestIdeas(req: BriefRequest, model: string, count: number) { return { ...(await this.inner.suggestIdeas(req, model, count)), model: 'fake-text' }; }
  async generateScene(prompt: string, opts: { model: string; quality: 'low' | 'medium' | 'high'; size: '1024x1536' | '1024x1024' | '1536x1024'; seedHint: string }) {
    this.sceneCalls++; this.lastScenePrompt = prompt;
    const f = this.failScene.shift(); if (f) throw f;
    return { ...(await this.inner.generateScene(prompt, opts)), model: 'fake-image' };
  }
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
