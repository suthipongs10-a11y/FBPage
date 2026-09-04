-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "aiMaxCostPerTaskUsd" DECIMAL(12,4),
ADD COLUMN     "aiMonthlyBudgetUsd" DECIMAL(12,4);

-- CreateTable
CREATE TABLE "AiProviderKey" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT,
    "encryptedApiKey" TEXT NOT NULL,
    "keyHint" TEXT,
    "baseUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastValidatedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProviderKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiRoleConfig" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiRoleConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageAnalysis" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "result" JSONB NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiProviderKey_workspaceId_provider_key" ON "AiProviderKey"("workspaceId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "AiRoleConfig_workspaceId_role_key" ON "AiRoleConfig"("workspaceId", "role");

-- CreateIndex
CREATE INDEX "PageAnalysis_pageId_createdAt_idx" ON "PageAnalysis"("pageId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiProviderKey" ADD CONSTRAINT "AiProviderKey_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRoleConfig" ADD CONSTRAINT "AiRoleConfig_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageAnalysis" ADD CONSTRAINT "PageAnalysis_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "FacebookPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
