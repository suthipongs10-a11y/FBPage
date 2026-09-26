-- ห้องข่าว: คีย์ค้นเว็บของ workspace + แหล่งข่าว (RSS/คำค้น) + ข่าวที่ดึงมา (เก็บแค่หัวข้อ/เกริ่น/ลิงก์ ไม่เก็บเนื้อหาเต็มหรือรูป)

-- CreateTable
CREATE TABLE "SearchProviderAccount" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'tavily',
    "apiKeyEnc" TEXT NOT NULL,
    "keyHint" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "lastError" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "callCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchProviderAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsSource" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'RSS',
    "label" TEXT NOT NULL,
    "url" TEXT,
    "query" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastFetchedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastNewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "sourceId" TEXT,
    "url" TEXT NOT NULL,
    "urlHash" TEXT NOT NULL,
    "titleHash" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "snippet" TEXT,
    "sourceName" TEXT,
    "publishedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "score" INTEGER,
    "angle" JSONB,
    "contentId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SearchProviderAccount_workspaceId_key" ON "SearchProviderAccount"("workspaceId");

-- CreateIndex
CREATE INDEX "NewsSource_brandId_idx" ON "NewsSource"("brandId");

-- CreateIndex
CREATE INDEX "NewsItem_brandId_status_fetchedAt_idx" ON "NewsItem"("brandId", "status", "fetchedAt");

-- CreateIndex
CREATE INDEX "NewsItem_brandId_titleHash_idx" ON "NewsItem"("brandId", "titleHash");

-- CreateIndex
CREATE UNIQUE INDEX "NewsItem_brandId_urlHash_key" ON "NewsItem"("brandId", "urlHash");

-- AddForeignKey
ALTER TABLE "SearchProviderAccount" ADD CONSTRAINT "SearchProviderAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsSource" ADD CONSTRAINT "NewsSource_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsItem" ADD CONSTRAINT "NewsItem_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsItem" ADD CONSTRAINT "NewsItem_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "NewsSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

