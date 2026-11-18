-- EDUCATION MASTER AI: educational print projects.
CREATE TABLE "edu_projects" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "content" JSONB,
    "source" TEXT,
    "images" JSONB,
    "steps" JSONB,
    "qc" JSONB,
    "exports" JSONB,
    "versions" JSONB,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "edu_projects_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "edu_projects_createdBy_updatedAt_idx" ON "edu_projects"("createdBy", "updatedAt");
