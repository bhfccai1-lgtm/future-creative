-- the real publish time from the provider (separate from our confirmation time)
ALTER TABLE "publication_results" ADD COLUMN "publishedAt" TIMESTAMP(3);
