-- «المبيعات»: quotes built in the system and the sales messages sent per customer.
ALTER TABLE "leads" ADD COLUMN "quote" JSONB, ADD COLUMN "quoteNo" INTEGER, ADD COLUMN "touches" JSONB;
CREATE UNIQUE INDEX "leads_quoteNo_key" ON "leads"("quoteNo");
