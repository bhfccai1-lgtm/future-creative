CREATE TABLE "competitor_snapshots" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "competitors" JSONB NOT NULL,
    "posts" JSONB NOT NULL,
    "error" TEXT,
    CONSTRAINT "competitor_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "competitor_snapshots_brandId_takenAt_idx" ON "competitor_snapshots"("brandId", "takenAt");
