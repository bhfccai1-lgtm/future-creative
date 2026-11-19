-- link a print design to its customer record (additive)
ALTER TABLE "print_projects" ADD COLUMN "leadId" TEXT;
CREATE INDEX "print_projects_leadId_idx" ON "print_projects"("leadId");
