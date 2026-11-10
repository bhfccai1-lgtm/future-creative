-- AlterTable
ALTER TABLE "publication_schedules" ADD COLUMN     "campaignId" TEXT;

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountIds" TEXT[],
    "productId" TEXT,
    "format" "MediaFormat",
    "language" "Language",
    "direction" JSONB,
    "scheduleType" TEXT NOT NULL DEFAULT 'RECURRING',
    "everyHours" INTEGER NOT NULL DEFAULT 24,
    "daysOfWeek" INTEGER[],
    "timeMode" TEXT NOT NULL DEFAULT 'BEST',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "maxRuns" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "runs" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaigns_active_nextRunAt_idx" ON "campaigns"("active", "nextRunAt");

-- AddForeignKey
ALTER TABLE "publication_schedules" ADD CONSTRAINT "publication_schedules_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
