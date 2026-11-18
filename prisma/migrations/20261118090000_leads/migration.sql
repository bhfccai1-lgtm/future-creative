-- «العملاء والطلبات»: inquiries → follow-up → won / lost, attributed to the account that brought them.
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "commentId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "name" TEXT,
    "contact" TEXT,
    "need" TEXT NOT NULL,
    "productId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "valueBhd" DOUBLE PRECISION,
    "lostReason" TEXT,
    "nextFollowUpAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdBy" TEXT,
    "firstContactAt" TIMESTAMP(3),
    "wonAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "leads_commentId_key" ON "leads"("commentId");
CREATE INDEX "leads_status_nextFollowUpAt_idx" ON "leads"("status", "nextFollowUpAt");
CREATE INDEX "leads_accountId_createdAt_idx" ON "leads"("accountId", "createdAt");
ALTER TABLE "leads" ADD CONSTRAINT "leads_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
