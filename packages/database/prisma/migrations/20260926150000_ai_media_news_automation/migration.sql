-- N-3 ภาพจาก AI (ใช้คีย์ AiConnection เดิม + เพดานภาพต่อเดือน + ประวัติงาน) · N-4 ห้องข่าวอัตโนมัติต่อแบรนด์ (ร่างรออนุมัติเท่านั้น)

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mediaJobId" TEXT,
ADD COLUMN     "sha256" TEXT;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "mediaMonthlyImageLimit" INTEGER;

-- CreateTable
CREATE TABLE "MediaModelConfig" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "unitCostUsd" DECIMAL(10,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaModelConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contentId" TEXT,
    "purpose" TEXT NOT NULL,
    "connectionId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "idempotencyKey" TEXT NOT NULL,
    "costUsd" DECIMAL(10,4),
    "outputAssetId" TEXT,
    "error" TEXT,
    "durationMs" INTEGER,
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "MediaJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsAutomation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "pageId" TEXT NOT NULL,
    "fetchEveryHours" INTEGER NOT NULL DEFAULT 3,
    "draftsPerDay" INTEGER NOT NULL DEFAULT 3,
    "minScore" INTEGER NOT NULL DEFAULT 60,
    "skipHighRisk" BOOLEAN NOT NULL DEFAULT true,
    "aiImage" BOOLEAN NOT NULL DEFAULT false,
    "theme" TEXT NOT NULL DEFAULT 'dark',
    "postingSlots" TEXT[] DEFAULT ARRAY['09:00', '12:30', '19:00']::TEXT[],
    "createdById" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lastFetchAt" TIMESTAMP(3),
    "lastResult" JSONB,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsAutomation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaModelConfig_workspaceId_purpose_key" ON "MediaModelConfig"("workspaceId", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "MediaJob_idempotencyKey_key" ON "MediaJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "MediaJob_workspaceId_createdAt_idx" ON "MediaJob"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NewsAutomation_brandId_key" ON "NewsAutomation"("brandId");

-- CreateIndex
CREATE INDEX "NewsAutomation_enabled_idx" ON "NewsAutomation"("enabled");

-- AddForeignKey
ALTER TABLE "MediaModelConfig" ADD CONSTRAINT "MediaModelConfig_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaModelConfig" ADD CONSTRAINT "MediaModelConfig_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "AiConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaJob" ADD CONSTRAINT "MediaJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsAutomation" ADD CONSTRAINT "NewsAutomation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsAutomation" ADD CONSTRAINT "NewsAutomation_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

