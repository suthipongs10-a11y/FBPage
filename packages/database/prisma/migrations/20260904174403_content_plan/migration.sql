-- AlterTable
ALTER TABLE "ContentItem" ADD COLUMN     "aiNotes" JSONB,
ADD COLUMN     "externalPostId" TEXT,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "planId" TEXT,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "reviewResult" JSONB;

-- CreateTable
CREATE TABLE "ContentPlan" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "objective" TEXT NOT NULL,
    "pillars" JSONB NOT NULL,
    "mix" JSONB NOT NULL,
    "items" JSONB NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentPlan_pageId_createdAt_idx" ON "ContentPlan"("pageId", "createdAt");

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ContentPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPlan" ADD CONSTRAINT "ContentPlan_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "FacebookPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
