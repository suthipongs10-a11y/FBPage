-- AlterTable
ALTER TABLE "FacebookPage" ADD COLUMN     "billingDay" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "planStartedAt" TIMESTAMP(3),
ADD COLUMN     "servicePlanId" TEXT;

-- CreateTable
CREATE TABLE "ServicePlan" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceMonthly" INTEGER,
    "postsPerMonth" INTEGER,
    "reelsPerMonth" INTEGER,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServicePlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServicePlan_workspaceId_active_idx" ON "ServicePlan"("workspaceId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ServicePlan_workspaceId_name_key" ON "ServicePlan"("workspaceId", "name");

-- AddForeignKey
ALTER TABLE "FacebookPage" ADD CONSTRAINT "FacebookPage_servicePlanId_fkey" FOREIGN KEY ("servicePlanId") REFERENCES "ServicePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePlan" ADD CONSTRAINT "ServicePlan_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

