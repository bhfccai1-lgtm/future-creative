-- «التعليقات»: comments on our Instagram posts + AI analysis; replies are human-sent drafts.
CREATE TABLE "social_comments" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "externalId" TEXT,
    "mediaId" TEXT,
    "permalink" TEXT,
    "username" TEXT,
    "text" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'manual',
    "category" TEXT,
    "sentiment" TEXT,
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT,
    "summary" TEXT,
    "suggestedReply" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "repliedText" TEXT,
    "repliedAt" TIMESTAMP(3),
    "repliedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "social_comments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "social_comments_externalId_key" ON "social_comments"("externalId");
CREATE INDEX "social_comments_accountId_status_idx" ON "social_comments"("accountId", "status");
CREATE INDEX "social_comments_status_urgent_createdAt_idx" ON "social_comments"("status", "urgent", "createdAt");
ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
