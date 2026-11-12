-- WhatsApp / Meta catalogue: starting price per product (optional; products without a price are not synced)
ALTER TABLE "products" ADD COLUMN "priceFrom" DOUBLE PRECISION;
ALTER TABLE "products" ADD COLUMN "catalogDescription" TEXT;
