-- ร่างโพสต์ชุมชน YouTube (คนคัดลอกไปโพสต์เอง — ไม่มี API ให้โพสต์)
CREATE TABLE "YouTubeCommunityDraft" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'TEXT',
    "text" TEXT NOT NULL,
    "pollOptions" TEXT[],
    "imageIdea" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceRef" TEXT,
    "aiModel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "remindedAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YouTubeCommunityDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "YouTubeCommunityDraft_channelId_status_idx" ON "YouTubeCommunityDraft"("channelId", "status");

-- CreateIndex
CREATE INDEX "YouTubeCommunityDraft_status_scheduledAt_idx" ON "YouTubeCommunityDraft"("status", "scheduledAt");

-- AddForeignKey
ALTER TABLE "YouTubeCommunityDraft" ADD CONSTRAINT "YouTubeCommunityDraft_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "YouTubeChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
