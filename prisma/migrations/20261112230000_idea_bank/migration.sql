-- Idea bank: rated ideas per account; approved ideas feed automatic generation
CREATE TYPE "IdeaStatus" AS ENUM ('NEW', 'APPROVED', 'USED', 'REJECTED');
CREATE TABLE "ideas" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "idea" TEXT NOT NULL,
  "hook" TEXT,
  "angle" TEXT,
  "format" TEXT,
  "occasion" TEXT,
  "score" DOUBLE PRECISION,
  "why" TEXT,
  "language" TEXT NOT NULL,
  "status" "IdeaStatus" NOT NULL DEFAULT 'NEW',
  "source" TEXT NOT NULL DEFAULT 'weekly',
  "usedAdId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ideas_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ideas_accountId_status_idx" ON "ideas"("accountId", "status");
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
