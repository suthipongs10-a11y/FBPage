-- AlterTable
ALTER TABLE "ContentItem" ADD COLUMN     "tiktokAccountId" TEXT;

-- CreateTable
CREATE TABLE "TikTokAccount" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "openId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "username" TEXT,
    "avatarUrl" TEXT,
    "followers" DOUBLE PRECISION,
    "following" DOUBLE PRECISION,
    "likes" DOUBLE PRECISION,
    "videoCount" DOUBLE PRECISION,
    "accessTokenEncrypted" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshExpiresAt" TIMESTAMP(3) NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "uploadsPaused" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TikTokAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TikTokOAuthState" (
    "hash" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "TikTokOAuthState_pkey" PRIMARY KEY ("hash")
);

-- CreateTable
CREATE TABLE "TikTokVideo" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "shareUrl" TEXT,
    "publishedAt" TIMESTAMP(3),
    "durationSeconds" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TikTokVideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentMetricSnapshot" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'TIKTOK',
    "tiktokVideoId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "views" DOUBLE PRECISION,
    "likes" DOUBLE PRECISION,
    "comments" DOUBLE PRECISION,
    "shares" DOUBLE PRECISION,

    CONSTRAINT "ContentMetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TikTokContentMetadata" (
    "contentId" TEXT NOT NULL,
    "hook" TEXT,
    "script" TEXT,
    "sourceUrl" TEXT,
    "uploadStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "publishId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "lastPolledAt" TIMESTAMP(3),

    CONSTRAINT "TikTokContentMetadata_pkey" PRIMARY KEY ("contentId")
);

-- CreateIndex
CREATE INDEX "TikTokAccount_brandId_idx" ON "TikTokAccount"("brandId");

-- CreateIndex
CREATE UNIQUE INDEX "TikTokAccount_workspaceId_openId_key" ON "TikTokAccount"("workspaceId", "openId");

-- CreateIndex
CREATE INDEX "TikTokOAuthState_expiresAt_idx" ON "TikTokOAuthState"("expiresAt");

-- CreateIndex
CREATE INDEX "TikTokVideo_accountId_publishedAt_idx" ON "TikTokVideo"("accountId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TikTokVideo_accountId_externalId_key" ON "TikTokVideo"("accountId", "externalId");

-- CreateIndex
CREATE INDEX "ContentMetricSnapshot_tiktokVideoId_capturedAt_idx" ON "ContentMetricSnapshot"("tiktokVideoId", "capturedAt");

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_tiktokAccountId_fkey" FOREIGN KEY ("tiktokAccountId") REFERENCES "TikTokAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TikTokAccount" ADD CONSTRAINT "TikTokAccount_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TikTokVideo" ADD CONSTRAINT "TikTokVideo_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TikTokAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentMetricSnapshot" ADD CONSTRAINT "ContentMetricSnapshot_tiktokVideoId_fkey" FOREIGN KEY ("tiktokVideoId") REFERENCES "TikTokVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TikTokContentMetadata" ADD CONSTRAINT "TikTokContentMetadata_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
