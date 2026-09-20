-- AlterTable
ALTER TABLE "ContentItem" ADD COLUMN     "platform" TEXT NOT NULL DEFAULT 'FACEBOOK',
ADD COLUMN     "youtubeChannelId" TEXT,
ADD COLUMN     "ytStatus" TEXT,
ALTER COLUMN "pageId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "sourcePlatform" TEXT NOT NULL DEFAULT 'FACEBOOK',
ADD COLUMN     "youtubeCommentId" TEXT;

-- CreateTable
CREATE TABLE "GoogleConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "email" TEXT,
    "accessTokenEncrypted" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastRefreshedAt" TIMESTAMP(3),
    "lastValidatedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YouTubeChannel" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "googleConnectionId" TEXT,
    "youtubeChannelId" TEXT NOT NULL,
    "accessMode" TEXT NOT NULL DEFAULT 'PUBLIC_API_KEY',
    "title" TEXT NOT NULL,
    "customUrl" TEXT,
    "description" TEXT,
    "country" TEXT,
    "defaultLanguage" TEXT,
    "thumbnailUrl" TEXT,
    "publishedAt" TIMESTAMP(3),
    "uploadsPlaylistId" TEXT,
    "subscriberCount" INTEGER,
    "videoCount" INTEGER,
    "viewCount" BIGINT,
    "timezone" TEXT,
    "automationLevel" "AutomationLevel" NOT NULL DEFAULT 'APPROVAL_REQUIRED',
    "automationPaused" BOOLEAN NOT NULL DEFAULT false,
    "uploadsPaused" BOOLEAN NOT NULL DEFAULT false,
    "policy" JSONB,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3),
    "syncStatus" TEXT NOT NULL DEFAULT 'IDLE',
    "syncError" TEXT,
    "commentsStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "analyticsStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "disconnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YouTubeChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YouTubeVideo" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "youtubeVideoId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "publishedAt" TIMESTAMP(3),
    "scheduledPublishAt" TIMESTAMP(3),
    "privacyStatus" TEXT,
    "uploadStatus" TEXT,
    "durationSeconds" INTEGER,
    "categoryId" TEXT,
    "defaultLanguage" TEXT,
    "defaultAudioLanguage" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "thumbnailUrl" TEXT,
    "madeForKids" BOOLEAN,
    "liveBroadcastContent" TEXT,
    "videoType" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "classifierVersion" TEXT,
    "contentPillar" TEXT,
    "pillarConfidence" DOUBLE PRECISION,
    "pillarManual" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'imported',
    "availability" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "commentsDisabled" BOOLEAN NOT NULL DEFAULT false,
    "viewCount" BIGINT,
    "likeCount" INTEGER,
    "commentCount" INTEGER,
    "rawData" JSONB,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YouTubeVideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YouTubeVideoMetricSnapshot" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metricSetVersion" TEXT NOT NULL,
    "metricsJson" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "window" TEXT NOT NULL DEFAULT 'LIFETIME',
    "dateRangeStart" TIMESTAMP(3),
    "dateRangeEnd" TIMESTAMP(3),

    CONSTRAINT "YouTubeVideoMetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YouTubeChannelMetricSnapshot" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rangeStart" TIMESTAMP(3),
    "rangeEnd" TIMESTAMP(3),
    "metricsJson" JSONB NOT NULL,
    "metricSetVersion" TEXT NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "YouTubeChannelMetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YouTubeComment" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "videoId" TEXT,
    "youtubeCommentId" TEXT NOT NULL,
    "parentCommentId" TEXT,
    "authorChannelId" TEXT,
    "authorDisplayName" TEXT,
    "text" TEXT NOT NULL,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3),
    "isReply" BOOLEAN NOT NULL DEFAULT false,
    "classification" TEXT,
    "sentiment" TEXT,
    "riskFlag" BOOLEAN NOT NULL DEFAULT false,
    "aiSummary" TEXT,
    "draftReply" TEXT,
    "replyStatus" TEXT NOT NULL DEFAULT 'NONE',
    "replyExternalId" TEXT,
    "repliedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "clusterId" TEXT,
    "rawData" JSONB,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "YouTubeComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommentCluster" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "topicId" TEXT,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "count" INTEGER NOT NULL DEFAULT 0,
    "representativeCommentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "kind" TEXT NOT NULL DEFAULT 'QUESTION',
    "confidence" DOUBLE PRECISION,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommentCluster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YouTubePlaylist" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "youtubePlaylistId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "privacyStatus" TEXT,
    "itemCount" INTEGER,
    "rawData" JSONB,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "YouTubePlaylist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YouTubePlaylistItem" (
    "id" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "YouTubePlaylistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YouTubeApiUsage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channelId" TEXT,
    "api" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "quotaUnitsEstimated" INTEGER NOT NULL,
    "calledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "success" BOOLEAN NOT NULL,
    "requestId" TEXT,

    CONSTRAINT "YouTubeApiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YouTubeSyncRun" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "totalExpected" INTEGER,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "cursorState" JSONB,
    "message" TEXT,

    CONSTRAINT "YouTubeSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YouTubeContentMetadata" (
    "contentItemId" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "categoryId" TEXT,
    "playlistIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "privacyStatus" TEXT NOT NULL DEFAULT 'private',
    "scheduledPublishAt" TIMESTAMP(3),
    "madeForKids" BOOLEAN,
    "syntheticMedia" BOOLEAN,
    "paidPlacement" BOOLEAN,
    "thumbnailAssetId" TEXT,
    "videoAssetId" TEXT,
    "format" TEXT NOT NULL DEFAULT 'LONG_FORM',
    "targetDurationSec" INTEGER,
    "hook" TEXT,
    "outline" JSONB,
    "script" TEXT,
    "titleCandidates" JSONB,
    "thumbnailBrief" JSONB,
    "research" JSONB,
    "objective" TEXT,
    "youtubeVideoId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YouTubeContentMetadata_pkey" PRIMARY KEY ("contentItemId")
);

-- CreateTable
CREATE TABLE "YouTubeUploadOperation" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "videoAssetId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "youtubeVideoId" TEXT,
    "resumableSessionUri" TEXT,
    "bytesSent" BIGINT NOT NULL DEFAULT 0,
    "totalBytes" BIGINT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YouTubeUploadOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YouTubeRecommendation" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "videoId" TEXT,
    "actionType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "why" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "confidence" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 50,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "outcome" JSONB,
    "source" TEXT NOT NULL DEFAULT 'analyst',
    "promptVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YouTubeRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YouTubeChannelAnalysis" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "result" JSONB NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "YouTubeChannelAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandInsight" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "platforms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "title" TEXT NOT NULL,
    "observation" TEXT NOT NULL,
    "inference" TEXT,
    "recommendation" TEXT,
    "evidence" JSONB,
    "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),

    CONSTRAINT "BrandInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentRelation" (
    "id" TEXT NOT NULL,
    "parentContentId" TEXT NOT NULL,
    "childContentId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentRelation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GoogleConnection_workspaceId_providerUserId_key" ON "GoogleConnection"("workspaceId", "providerUserId");

-- CreateIndex
CREATE INDEX "YouTubeChannel_googleConnectionId_idx" ON "YouTubeChannel"("googleConnectionId");

-- CreateIndex
CREATE UNIQUE INDEX "YouTubeChannel_brandId_youtubeChannelId_key" ON "YouTubeChannel"("brandId", "youtubeChannelId");

-- CreateIndex
CREATE INDEX "YouTubeVideo_channelId_publishedAt_idx" ON "YouTubeVideo"("channelId", "publishedAt");

-- CreateIndex
CREATE INDEX "YouTubeVideo_channelId_videoType_idx" ON "YouTubeVideo"("channelId", "videoType");

-- CreateIndex
CREATE UNIQUE INDEX "YouTubeVideo_channelId_youtubeVideoId_key" ON "YouTubeVideo"("channelId", "youtubeVideoId");

-- CreateIndex
CREATE INDEX "YouTubeVideoMetricSnapshot_videoId_capturedAt_idx" ON "YouTubeVideoMetricSnapshot"("videoId", "capturedAt");

-- CreateIndex
CREATE INDEX "YouTubeVideoMetricSnapshot_videoId_window_idx" ON "YouTubeVideoMetricSnapshot"("videoId", "window");

-- CreateIndex
CREATE INDEX "YouTubeChannelMetricSnapshot_channelId_capturedAt_idx" ON "YouTubeChannelMetricSnapshot"("channelId", "capturedAt");

-- CreateIndex
CREATE INDEX "YouTubeComment_channelId_publishedAt_idx" ON "YouTubeComment"("channelId", "publishedAt");

-- CreateIndex
CREATE INDEX "YouTubeComment_videoId_idx" ON "YouTubeComment"("videoId");

-- CreateIndex
CREATE UNIQUE INDEX "YouTubeComment_channelId_youtubeCommentId_key" ON "YouTubeComment"("channelId", "youtubeCommentId");

-- CreateIndex
CREATE INDEX "CommentCluster_channelId_count_idx" ON "CommentCluster"("channelId", "count");

-- CreateIndex
CREATE UNIQUE INDEX "YouTubePlaylist_channelId_youtubePlaylistId_key" ON "YouTubePlaylist"("channelId", "youtubePlaylistId");

-- CreateIndex
CREATE UNIQUE INDEX "YouTubePlaylistItem_playlistId_videoId_key" ON "YouTubePlaylistItem"("playlistId", "videoId");

-- CreateIndex
CREATE INDEX "YouTubeApiUsage_workspaceId_calledAt_idx" ON "YouTubeApiUsage"("workspaceId", "calledAt");

-- CreateIndex
CREATE INDEX "YouTubeSyncRun_channelId_startedAt_idx" ON "YouTubeSyncRun"("channelId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "YouTubeUploadOperation_idempotencyKey_key" ON "YouTubeUploadOperation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "YouTubeUploadOperation_contentItemId_idx" ON "YouTubeUploadOperation"("contentItemId");

-- CreateIndex
CREATE INDEX "YouTubeRecommendation_channelId_status_idx" ON "YouTubeRecommendation"("channelId", "status");

-- CreateIndex
CREATE INDEX "YouTubeChannelAnalysis_channelId_createdAt_idx" ON "YouTubeChannelAnalysis"("channelId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Topic_brandId_canonicalName_key" ON "Topic"("brandId", "canonicalName");

-- CreateIndex
CREATE INDEX "BrandInsight_brandId_createdAt_idx" ON "BrandInsight"("brandId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContentRelation_parentContentId_childContentId_relationType_key" ON "ContentRelation"("parentContentId", "childContentId", "relationType");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_youtubeCommentId_key" ON "Lead"("youtubeCommentId");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_youtubeCommentId_fkey" FOREIGN KEY ("youtubeCommentId") REFERENCES "YouTubeComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_youtubeChannelId_fkey" FOREIGN KEY ("youtubeChannelId") REFERENCES "YouTubeChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleConnection" ADD CONSTRAINT "GoogleConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleConnection" ADD CONSTRAINT "GoogleConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YouTubeChannel" ADD CONSTRAINT "YouTubeChannel_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YouTubeChannel" ADD CONSTRAINT "YouTubeChannel_googleConnectionId_fkey" FOREIGN KEY ("googleConnectionId") REFERENCES "GoogleConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YouTubeVideo" ADD CONSTRAINT "YouTubeVideo_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "YouTubeChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YouTubeVideoMetricSnapshot" ADD CONSTRAINT "YouTubeVideoMetricSnapshot_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "YouTubeVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YouTubeChannelMetricSnapshot" ADD CONSTRAINT "YouTubeChannelMetricSnapshot_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "YouTubeChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YouTubeComment" ADD CONSTRAINT "YouTubeComment_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "YouTubeChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YouTubeComment" ADD CONSTRAINT "YouTubeComment_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "YouTubeVideo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YouTubeComment" ADD CONSTRAINT "YouTubeComment_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "CommentCluster"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentCluster" ADD CONSTRAINT "CommentCluster_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "YouTubeChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentCluster" ADD CONSTRAINT "CommentCluster_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YouTubePlaylist" ADD CONSTRAINT "YouTubePlaylist_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "YouTubeChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YouTubePlaylistItem" ADD CONSTRAINT "YouTubePlaylistItem_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "YouTubePlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YouTubePlaylistItem" ADD CONSTRAINT "YouTubePlaylistItem_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "YouTubeVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YouTubeApiUsage" ADD CONSTRAINT "YouTubeApiUsage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YouTubeSyncRun" ADD CONSTRAINT "YouTubeSyncRun_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "YouTubeChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YouTubeContentMetadata" ADD CONSTRAINT "YouTubeContentMetadata_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YouTubeUploadOperation" ADD CONSTRAINT "YouTubeUploadOperation_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YouTubeRecommendation" ADD CONSTRAINT "YouTubeRecommendation_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "YouTubeChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YouTubeRecommendation" ADD CONSTRAINT "YouTubeRecommendation_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "YouTubeVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YouTubeChannelAnalysis" ADD CONSTRAINT "YouTubeChannelAnalysis_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "YouTubeChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandInsight" ADD CONSTRAINT "BrandInsight_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentRelation" ADD CONSTRAINT "ContentRelation_parentContentId_fkey" FOREIGN KEY ("parentContentId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentRelation" ADD CONSTRAINT "ContentRelation_childContentId_fkey" FOREIGN KEY ("childContentId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

