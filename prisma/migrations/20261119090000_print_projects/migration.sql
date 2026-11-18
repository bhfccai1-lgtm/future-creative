-- PRINT DESIGN STUDIO projects (additive)
CREATE TABLE "print_projects" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "brief" JSONB NOT NULL,
    "analysis" JSONB,
    "concepts" JSONB,
    "conceptKey" TEXT,
    "images" JSONB,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "approvedHash" TEXT,
    "approvedAt" TIMESTAMP(3),
    "qa" JSONB,
    "exports" JSONB,
    "mockupKey" TEXT,
    "versions" JSONB,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "print_projects_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "print_projects_createdBy_updatedAt_idx" ON "print_projects"("createdBy", "updatedAt");
