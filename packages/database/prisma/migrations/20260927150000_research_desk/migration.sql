-- โต๊ะค้นคว้า: สรุปประเด็นจากหลายแหล่ง (เก็บแค่ลิงก์ + excerpt) → เขียนโพสต์ผ่านทางนำเข้าเดิม

CREATE TABLE "ResearchBrief" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "query" TEXT,
    "sources" JSONB NOT NULL,
    "brief" JSONB NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "costUsd" DOUBLE PRECISION,
    "lastImportId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ResearchBrief_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ResearchBrief_brandId_createdAt_idx" ON "ResearchBrief"("brandId", "createdAt");
ALTER TABLE "ResearchBrief" ADD CONSTRAINT "ResearchBrief_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchBrief" ADD CONSTRAINT "ResearchBrief_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
