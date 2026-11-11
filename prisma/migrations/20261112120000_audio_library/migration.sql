-- Licensed music library for reels (additive)
CREATE TABLE "audio_tracks" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mood" TEXT NOT NULL DEFAULT 'upbeat',
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "durationSec" DOUBLE PRECISION NOT NULL,
    "startSec" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bpm" INTEGER,
    "licenseNote" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audio_tracks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "audio_tracks_storageKey_key" ON "audio_tracks"("storageKey");
CREATE INDEX "audio_tracks_active_mood_idx" ON "audio_tracks"("active", "mood");
