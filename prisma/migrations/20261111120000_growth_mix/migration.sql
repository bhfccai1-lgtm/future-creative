-- Growth content mix (opt-in per account) and shorter default reel for new accounts
ALTER TABLE "social_accounts" ADD COLUMN "formatStrategy" TEXT NOT NULL DEFAULT 'FIXED';
ALTER TABLE "social_accounts" ADD COLUMN "formatMix" JSONB;
ALTER TABLE "social_accounts" ALTER COLUMN "reelDurationSec" SET DEFAULT 10;
