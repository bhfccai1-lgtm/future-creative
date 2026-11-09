-- CreateEnum
CREATE TYPE "Language" AS ENUM ('ar', 'en', 'ml');

-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('instagram', 'facebook', 'tiktok', 'threads', 'youtube', 'pinterest', 'linkedin', 'twitter');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('NOT_CONNECTED', 'PENDING_VERIFICATION', 'CONNECTED', 'EXPIRED', 'INSUFFICIENT_PERMISSIONS', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "MediaFormat" AS ENUM ('IMAGE_STORY', 'IMAGE_FEED', 'IMAGE_SQUARE', 'REEL_VIDEO');

-- CreateEnum
CREATE TYPE "AdState" AS ENUM ('DRAFT', 'GENERATING', 'GENERATED', 'QUALITY_REVIEW', 'APPROVED', 'QUEUED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'UNKNOWN', 'REJECTED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AiJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'BLOCKED_BUDGET');

-- CreateEnum
CREATE TYPE "FingerprintKind" AS ENUM ('FILE_SHA256', 'PHASH', 'HEADLINE', 'IDEA', 'PRODUCT_OCCASION');

-- CreateEnum
CREATE TYPE "AttemptOutcome" AS ENUM ('ACCEPTED', 'REJECTED', 'RATE_LIMITED', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "NotificationLevel" AS ENUM ('INFO', 'WARNING', 'ERROR', 'CRITICAL');

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "businesses" (
    "id" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "defaultCtaAr" TEXT NOT NULL DEFAULT 'اطلب الآن',
    "defaultCtaEn" TEXT NOT NULL DEFAULT 'Order Now',
    "defaultCtaMl" TEXT NOT NULL DEFAULT 'ഇപ്പോൾ ഓർഡർ ചെയ്യൂ',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Bahrain',
    "currency" TEXT NOT NULL DEFAULT 'BHD',
    "locations" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_assets" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "hasAlpha" BOOLEAN NOT NULL,
    "mimeType" TEXT NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_accounts" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "handle" TEXT,
    "externalId" TEXT,
    "language" "Language" NOT NULL DEFAULT 'ar',
    "businessCategory" TEXT,
    "allowedProductIds" TEXT[],
    "publishFormat" "MediaFormat" NOT NULL DEFAULT 'IMAGE_STORY',
    "publishIntervalMinutes" INTEGER NOT NULL DEFAULT 60,
    "publishWindowStart" TEXT NOT NULL DEFAULT '09:00',
    "publishWindowEnd" TEXT NOT NULL DEFAULT '22:00',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Bahrain',
    "reelDurationSec" INTEGER NOT NULL DEFAULT 12,
    "autoPublishEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autonomousAuthorized" BOOLEAN NOT NULL DEFAULT false,
    "autonomousAuthorizedAt" TIMESTAMP(3),
    "autonomousAuthorizedBy" TEXT,
    "nextPublishAt" TIMESTAMP(3),
    "lastPublishedAt" TIMESTAMP(3),
    "maxDailyAds" INTEGER NOT NULL DEFAULT 24,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_connections" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerBrandId" TEXT,
    "providerNetwork" TEXT,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'NOT_CONNECTED',
    "encryptedToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[],
    "canPublish" BOOLEAN NOT NULL DEFAULT false,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "providerSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_categories" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameMl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleMl" TEXT,
    "targetAudience" TEXT[],
    "occasions" TEXT[],
    "visualGuidelines" TEXT NOT NULL,
    "recommendedMessages" JSONB NOT NULL,
    "relevantAccountTags" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "performanceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creative_briefs" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "language" "Language" NOT NULL,
    "ideaKey" TEXT NOT NULL,
    "idea" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "occasion" TEXT NOT NULL,
    "sceneDescription" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "supportingCopy" TEXT,
    "cta" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "hashtags" TEXT[],
    "styleNotes" TEXT,
    "rawJson" JSONB NOT NULL,
    "provider" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creative_briefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_templates" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "format" "MediaFormat" NOT NULL,
    "layout" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "design_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advertisements" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "briefId" TEXT,
    "templateKey" TEXT,
    "format" "MediaFormat" NOT NULL,
    "language" "Language" NOT NULL,
    "state" "AdState" NOT NULL DEFAULT 'DRAFT',
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "headline" TEXT,
    "caption" TEXT,
    "logoSha256" TEXT,
    "qcReport" JSONB,
    "qcPassed" BOOLEAN NOT NULL DEFAULT false,
    "layerManifest" JSONB,
    "errorMessage" TEXT,
    "scheduleId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "advertisements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "advertisementId" TEXT,
    "role" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "durationSec" DOUBLE PRECISION,
    "bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "phash" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_fingerprints" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "advertisementId" TEXT NOT NULL,
    "kind" "FingerprintKind" NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_fingerprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publication_schedules" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "slotAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "publication_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publication_jobs" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "advertisementId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "state" "AdState" NOT NULL DEFAULT 'QUEUED',
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "lockedBy" TEXT,
    "lockedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextCheckAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "publication_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publication_attempts" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "outcome" "AttemptOutcome",
    "httpStatus" INTEGER,
    "requestSummary" JSONB,
    "responseSummary" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "publication_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publication_results" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "providerPostId" TEXT,
    "providerStatus" TEXT,
    "publicUrl" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "metrics" JSONB,
    "engagementScore" DOUBLE PRECISION,
    "rawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "publication_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "advertisementId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_generation_jobs" (
    "id" TEXT NOT NULL,
    "advertisementId" TEXT,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" "AiJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_generation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage" (
    "id" TEXT NOT NULL,
    "jobId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "images" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorLabel" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "details" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "level" "NotificationLevel" NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "accountId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "secret" BOOLEAN NOT NULL DEFAULT false,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "brand_assets_businessId_kind_active_idx" ON "brand_assets"("businessId", "kind", "active");

-- CreateIndex
CREATE INDEX "social_accounts_autoPublishEnabled_nextPublishAt_idx" ON "social_accounts"("autoPublishEnabled", "nextPublishAt");

-- CreateIndex
CREATE UNIQUE INDEX "social_connections_accountId_key" ON "social_connections"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_slug_key" ON "product_categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE INDEX "products_active_idx" ON "products"("active");

-- CreateIndex
CREATE INDEX "creative_briefs_accountId_createdAt_idx" ON "creative_briefs"("accountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "design_templates_key_key" ON "design_templates"("key");

-- CreateIndex
CREATE UNIQUE INDEX "advertisements_scheduleId_key" ON "advertisements"("scheduleId");

-- CreateIndex
CREATE INDEX "advertisements_accountId_createdAt_idx" ON "advertisements"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "advertisements_state_idx" ON "advertisements"("state");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_storageKey_key" ON "media_assets"("storageKey");

-- CreateIndex
CREATE INDEX "media_assets_sha256_idx" ON "media_assets"("sha256");

-- CreateIndex
CREATE INDEX "content_fingerprints_accountId_kind_createdAt_idx" ON "content_fingerprints"("accountId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "content_fingerprints_kind_value_idx" ON "content_fingerprints"("kind", "value");

-- CreateIndex
CREATE INDEX "publication_schedules_slotAt_status_idx" ON "publication_schedules"("slotAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "publication_schedules_accountId_slotAt_key" ON "publication_schedules"("accountId", "slotAt");

-- CreateIndex
CREATE UNIQUE INDEX "publication_jobs_idempotencyKey_key" ON "publication_jobs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "publication_jobs_state_nextCheckAt_idx" ON "publication_jobs"("state", "nextCheckAt");

-- CreateIndex
CREATE UNIQUE INDEX "publication_attempts_jobId_attemptNo_key" ON "publication_attempts"("jobId", "attemptNo");

-- CreateIndex
CREATE UNIQUE INDEX "publication_results_jobId_key" ON "publication_results"("jobId");

-- CreateIndex
CREATE INDEX "approval_requests_status_createdAt_idx" ON "approval_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ai_generation_jobs_status_idx" ON "ai_generation_jobs"("status");

-- CreateIndex
CREATE INDEX "ai_usage_createdAt_idx" ON "ai_usage"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_targetType_targetId_idx" ON "audit_logs"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "notifications_readAt_createdAt_idx" ON "notifications"("readAt", "createdAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_assets" ADD CONSTRAINT "brand_assets_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_connections" ADD CONSTRAINT "social_connections_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "product_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_briefs" ADD CONSTRAINT "creative_briefs_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advertisements" ADD CONSTRAINT "advertisements_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advertisements" ADD CONSTRAINT "advertisements_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advertisements" ADD CONSTRAINT "advertisements_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "creative_briefs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advertisements" ADD CONSTRAINT "advertisements_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "publication_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_advertisementId_fkey" FOREIGN KEY ("advertisementId") REFERENCES "advertisements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_fingerprints" ADD CONSTRAINT "content_fingerprints_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_fingerprints" ADD CONSTRAINT "content_fingerprints_advertisementId_fkey" FOREIGN KEY ("advertisementId") REFERENCES "advertisements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_schedules" ADD CONSTRAINT "publication_schedules_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_jobs" ADD CONSTRAINT "publication_jobs_advertisementId_fkey" FOREIGN KEY ("advertisementId") REFERENCES "advertisements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_jobs" ADD CONSTRAINT "publication_jobs_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_attempts" ADD CONSTRAINT "publication_attempts_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "publication_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_results" ADD CONSTRAINT "publication_results_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "publication_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_advertisementId_fkey" FOREIGN KEY ("advertisementId") REFERENCES "advertisements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ai_generation_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
