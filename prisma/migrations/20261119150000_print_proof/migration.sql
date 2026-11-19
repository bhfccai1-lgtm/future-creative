-- online client proof for PRINT DESIGN STUDIO projects (additive)
ALTER TABLE "print_projects" ADD COLUMN "proofToken" TEXT;
ALTER TABLE "print_projects" ADD COLUMN "proofHash" TEXT;
ALTER TABLE "print_projects" ADD COLUMN "proofExpiresAt" TIMESTAMP(3);
ALTER TABLE "print_projects" ADD COLUMN "proofKeys" JSONB;
ALTER TABLE "print_projects" ADD COLUMN "clientDecision" JSONB;
CREATE UNIQUE INDEX "print_projects_proofToken_key" ON "print_projects"("proofToken");
