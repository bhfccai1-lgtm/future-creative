import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { storage } from '@/lib/storage';
import { generateAdvertisement } from '@/lib/pipeline/generate';
import { setAiProviderOverride } from '@/lib/ai';
import { AiProviderError } from '@/lib/ai/types';
import { updateSettings } from '@/lib/settings';
import { findDuplicates } from '@/lib/dedup';
import { recordUsage } from '@/lib/ai/cost';
import { LogoUnavailableError } from '@/lib/brand/logo';
import type { QcReport } from '@/lib/qc';
import { captureQueues, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });

describe('content generation pipeline', () => {
  it('dry-run: generates a complete layered design, passes design QC, but is never publishable', async () => {
    const { accounts } = await seedBase();
    const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 'tester' });
    expect(r.advertisement.state).toBe('QUALITY_REVIEW');
    expect(r.advertisement.dryRun).toBe(true);
    expect(r.qc?.passed).toBe(true);
    expect(r.qc?.publishable).toBe(false);
    expect(r.qc?.checks.find((c) => c.id === 'real_ai_media')?.passed).toBe(false);
    const media = await prisma.mediaAsset.findMany({ where: { advertisementId: r.advertisement.id } });
    expect(media.map((m) => m.role).sort()).toEqual(['FINAL', 'SCENE']);
    expect(await storage().exists(media.find((m) => m.role === 'FINAL')!.storageKey)).toBe(true);
    expect(await prisma.approvalRequest.count({ where: { advertisementId: r.advertisement.id, status: 'PENDING', reason: 'MANUAL_MODE' } })).toBe(1);
    expect(await prisma.contentFingerprint.count({ where: { advertisementId: r.advertisement.id } })).toBe(5);
    expect(await prisma.aiUsage.count()).toBe(0); // dry-run costs nothing
  });

  it('real-AI path (mocked provider): records token/image usage and costs; ad is publishable', async () => {
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
    const ai = new FakeAiProvider(); setAiProviderOverride(ai);
    const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 'tester' });
    expect(r.qc?.publishable).toBe(true);
    const usage = await prisma.aiUsage.findMany();
    expect(usage.map((u) => u.kind).sort()).toEqual(['image', 'text']);
    expect(Number(usage.find((u) => u.kind === 'image')!.costUsd)).toBeCloseTo(0.063, 3);
    const qc = r.advertisement.qcReport as unknown as QcReport;
    for (const id of ['logo_present', 'logo_fingerprint', 'logo_pixels', 'phones', 'language_match', 'claims', 'text_fit', 'no_overlap', 'image_dimensions', 'duplicates']) {
      expect(qc.checks.find((c) => c.id === id)?.passed, id).toBe(true);
    }
  });

  it('blocks generation when no approved logo exists', async () => {
    const { accounts } = await seedBase();
    await prisma.brandAsset.updateMany({ data: { active: false } });
    await expect(generateAdvertisement({ accountId: accounts[0].id, createdBy: 't' })).rejects.toBeInstanceOf(LogoUnavailableError);
    expect(await prisma.advertisement.count()).toBe(0);
  });

  it('blocks generation when the stored logo no longer matches its SHA-256 fingerprint', async () => {
    const { accounts } = await seedBase();
    const logo = await prisma.brandAsset.findFirstOrThrow({ where: { active: true } });
    await storage().put(logo.storageKey, Buffer.from('tampered-bytes'), 'image/png');
    await expect(generateAdvertisement({ accountId: accounts[0].id, createdBy: 't' })).rejects.toThrow(/بصمة الشعار/);
  });

  it('failed AI requests: non-retryable auth error fails the ad and raises a critical alert', async () => {
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
    const ai = new FakeAiProvider(); ai.failBrief.push(new AiProviderError('AUTH', 'invalid key', false)); setAiProviderOverride(ai);
    const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't' });
    expect(r.advertisement.state).toBe('FAILED');
    expect(ai.briefCalls).toBe(1);
    expect(await prisma.notification.count({ where: { level: 'CRITICAL', code: 'GEN_AUTH' } })).toBe(1);
    expect(await prisma.aiGenerationJob.count({ where: { status: 'FAILED' } })).toBe(1);
  });

  it('failed AI requests: retryable errors are retried within the configured limit', async () => {
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false, maxRetries: 2 } }) });
    const ai = new FakeAiProvider();
    ai.failScene.push(new AiProviderError('RATE_LIMIT', '429', true), new AiProviderError('NETWORK', '502', true));
    setAiProviderOverride(ai);
    const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't' });
    expect(ai.sceneCalls).toBe(3);
    expect(r.advertisement.state).toBe('QUALITY_REVIEW');
  });

  it('monthly spending limit blocks AI generation before any call is made', async () => {
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false, monthlyBudgetUsd: 1 } }) });
    await recordUsage({ provider: 'openai', model: 'x', kind: 'image', images: 1, costUsd: 0.99 });
    const ai = new FakeAiProvider(); setAiProviderOverride(ai);
    await expect(generateAdvertisement({ accountId: accounts[0].id, createdBy: 't' })).rejects.toThrow(/budget/i);
    expect(ai.briefCalls).toBe(0);
    expect(ai.sceneCalls).toBe(0);
    expect(await prisma.advertisement.count()).toBe(0);
    expect(await prisma.aiGenerationJob.count()).toBe(0);
    expect(await prisma.notification.count({ where: { code: 'BUDGET_EXCEEDED' } })).toBe(1);
  });

  it('enforces the per-account daily limit', async () => {
    const { accounts } = await seedBase();
    await prisma.socialAccount.update({ where: { id: accounts[0].id }, data: { maxDailyAds: 1 } });
    await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't' });
    await expect(generateAdvertisement({ accountId: accounts[0].id, createdBy: 't' })).rejects.toThrow(/الحد اليومي/);
  });

  it('respects the account product allow-list', async () => {
    const { accounts } = await seedBase();
    const mug = await prisma.product.findFirstOrThrow({ where: { slug: 'vinyl-stickers' } });
    await prisma.socialAccount.update({ where: { id: accounts[0].id }, data: { allowedProductIds: [mug.id] } });
    for (let i = 0; i < 3; i++) {
      const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't' });
      expect(r.advertisement.productId).toBe(mug.id);
    }
  });
});

describe('duplicate prevention', () => {
  it('never repeats an idea or headline on the same account within the window', async () => {
    const { accounts } = await seedBase({ productCount: 1 });
    const ads = [];
    for (let i = 0; i < 4; i++) ads.push((await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't' })).advertisement);
    const briefs = await prisma.creativeBrief.findMany({ where: { accountId: accounts[0].id } });
    expect(new Set(briefs.map((b) => b.ideaKey)).size).toBe(4); // same product, genuinely different concepts
    expect(new Set(briefs.map((b) => b.headline)).size).toBe(4);
    expect(ads.every((a) => a.state === 'QUALITY_REVIEW')).toBe(true);
  });

  it('detects exact-file and perceptual duplicates; history is per account', async () => {
    const { accounts } = await seedBase();
    const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't' });
    const fps = await prisma.contentFingerprint.findMany({ where: { advertisementId: r.advertisement.id } });
    const sha = fps.find((f) => f.kind === 'FILE_SHA256')!.value;
    const ph = fps.find((f) => f.kind === 'PHASH')!.value;
    const same = await findDuplicates(accounts[0].id, { sha256: sha, phash: ph }, 30);
    expect(same.map((d) => d.kind)).toEqual(expect.arrayContaining(['FILE_SHA256', 'PHASH']));
    const cross = await findDuplicates(accounts[1].id, { sha256: sha, phash: ph }, 30);
    expect(cross.every((d) => d.scope === 'cross-account')).toBe(true);
    expect(cross.length).toBeGreaterThan(0);
    // outside the window (fingerprints older than 30 days) nothing is reported
    await prisma.contentFingerprint.updateMany({ data: { createdAt: new Date(Date.now() - 31 * 86400_000) } });
    expect(await findDuplicates(accounts[0].id, { sha256: sha, phash: ph }, 30)).toEqual([]);
  });
});

describe('reel pipeline', () => {
  it('produces and stores a validated MP4 (not a still image) for REEL_VIDEO accounts', async () => {
    const { accounts } = await seedBase();
    await prisma.socialAccount.update({ where: { id: accounts[0].id }, data: { publishFormat: 'REEL_VIDEO', reelDurationSec: 6 } });
    const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't' });
    expect(r.advertisement.state).toBe('QUALITY_REVIEW');
    const video = await prisma.mediaAsset.findFirstOrThrow({ where: { advertisementId: r.advertisement.id, role: 'VIDEO' } });
    expect(video.mimeType).toBe('video/mp4');
    expect(video.durationSec).toBeCloseTo(6, 0);
    expect(r.qc?.checks.find((c) => c.id === 'video_valid')?.passed).toBe(true);
  }, 180_000);
});

describe('creative direction', () => {
  it('content language overrides the account language; occasion + idea reach the brief', async () => {
    const { accounts } = await seedBase();
    expect(accounts[0].language).toBe('ar');
    const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', language: 'en', direction: { occasion: 'bahrain_national_day', segment: 'companies', contentType: 'business_branding', idea: 'Corporate gift box for National Day' } });
    expect(r.advertisement.state).toBe('QUALITY_REVIEW');
    expect(r.advertisement.language).toBe('en');
    expect(r.qc?.checks.find((c) => c.id === 'language_match')?.passed).toBe(true);
    const brief = await prisma.creativeBrief.findFirstOrThrow({ where: { id: r.advertisement.briefId! } });
    expect(brief.language).toBe('en');
    expect(brief.occasion).toBe('Bahrain National Day');
    expect(brief.headline).toBe('Celebrating Bahrain National Day');
    expect(brief.idea).toContain('Corporate gift box for National Day');
    expect((brief.rawJson as { direction?: { segment?: string } }).direction?.segment).toBe('companies');
    const manifest = r.advertisement.layerManifest as { layers: { id: string; text?: string }[] };
    expect(manifest.layers.find((l) => l.id === 'cta')?.text).toBe('Order Now');
    expect(manifest.layers.find((l) => l.id === 'contact:saar:label')?.text).toBe('Saar');
  });
});
