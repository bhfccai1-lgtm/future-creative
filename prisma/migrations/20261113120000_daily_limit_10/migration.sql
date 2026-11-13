-- Owner request (2026-11-13): per-account daily design limit 10 (was 4).
ALTER TABLE "social_accounts" ALTER COLUMN "maxDailyAds" SET DEFAULT 10;
UPDATE "social_accounts" SET "maxDailyAds" = 10 WHERE "maxDailyAds" < 10;
