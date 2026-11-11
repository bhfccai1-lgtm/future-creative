-- V8: per-account pause, 7-hour default interval, approval media binding, analytics import metadata
ALTER TABLE "social_accounts" ADD COLUMN "paused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "social_accounts" ADD COLUMN "pausedReason" TEXT;
ALTER TABLE "social_accounts" ADD COLUMN "pausedAt" TIMESTAMP(3);
ALTER TABLE "social_accounts" ALTER COLUMN "publishIntervalMinutes" SET DEFAULT 420;
ALTER TABLE "social_accounts" ALTER COLUMN "maxDailyAds" SET DEFAULT 4;
-- accounts still on the old untouched defaults move to the 7-hour cadence; customised accounts are kept as-is
UPDATE "social_accounts" SET "publishIntervalMinutes" = 420 WHERE "publishIntervalMinutes" = 60;
UPDATE "social_accounts" SET "maxDailyAds" = 4 WHERE "maxDailyAds" = 24;
ALTER TABLE "approval_requests" ADD COLUMN "mediaSha256" TEXT;
ALTER TABLE "publication_results" ADD COLUMN "metricsFetchedAt" TIMESTAMP(3);
ALTER TABLE "publication_results" ADD COLUMN "metricsSource" TEXT;
