-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "monitorEnabled" BOOLEAN NOT NULL DEFAULT true,
    "checkIntervalMin" INTEGER NOT NULL DEFAULT 15,
    "expectedText" TEXT,
    "lastStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "lastHttpStatus" INTEGER,
    "lastLatencyMs" INTEGER,
    "lastCheckedAt" TIMESTAMP(3),
    "sslExpiresAt" TIMESTAMP(3),
    "sslIssuer" TEXT,
    "googleConnectionId" TEXT,
    "searchConsoleProperty" TEXT,
    "gscStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "gscSyncedAt" TIMESTAMP(3),
    "settings" JSONB,
    "disconnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteCheck" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "latencyMs" INTEGER,
    "details" JSONB,
    "error" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteIncident" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "summary" TEXT NOT NULL,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "SiteIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchSnapshot" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "clicks" INTEGER,
    "impressions" INTEGER,
    "ctr" DOUBLE PRECISION,
    "position" DOUBLE PRECISION,
    "topQueries" JSONB,
    "topPages" JSONB,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteAnalysis" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Site_brandId_url_key" ON "Site"("brandId", "url");

-- CreateIndex
CREATE INDEX "SiteCheck_siteId_kind_checkedAt_idx" ON "SiteCheck"("siteId", "kind", "checkedAt");

-- CreateIndex
CREATE INDEX "SiteIncident_siteId_kind_resolvedAt_idx" ON "SiteIncident"("siteId", "kind", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SearchSnapshot_siteId_date_key" ON "SearchSnapshot"("siteId", "date");

-- CreateIndex
CREATE INDEX "SiteAnalysis_siteId_createdAt_idx" ON "SiteAnalysis"("siteId", "createdAt");

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_googleConnectionId_fkey" FOREIGN KEY ("googleConnectionId") REFERENCES "GoogleConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteCheck" ADD CONSTRAINT "SiteCheck_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteIncident" ADD CONSTRAINT "SiteIncident_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchSnapshot" ADD CONSTRAINT "SearchSnapshot_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteAnalysis" ADD CONSTRAINT "SiteAnalysis_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

