-- production tracking for print designs (additive)
ALTER TABLE "print_projects" ADD COLUMN "production" JSONB;
