-- Large catalogues: allow whole categories per account, index products by category
ALTER TABLE "social_accounts" ADD COLUMN "allowedCategoryIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
CREATE INDEX "products_categoryId_active_idx" ON "products"("categoryId", "active");
