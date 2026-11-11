-- Google Business Profile channel + per-job network routing (satellite jobs)
ALTER TYPE "SocialPlatform" ADD VALUE IF NOT EXISTS 'gmb';
ALTER TABLE "publication_jobs" ADD COLUMN "networks" "SocialPlatform"[] DEFAULT ARRAY[]::"SocialPlatform"[];
ALTER TABLE "publication_jobs" ADD COLUMN "primary" BOOLEAN NOT NULL DEFAULT true;
