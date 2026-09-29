-- ผลวิเคราะห์คอมเมนต์ที่น่าสนใจ (จัดอันดับ + ไอเดียหัวข้อ)
CREATE TABLE "YouTubeCommentHighlightRun" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "commentCount" INTEGER NOT NULL,
    "result" JSONB NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "YouTubeCommentHighlightRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "YouTubeCommentHighlightRun_channelId_createdAt_idx" ON "YouTubeCommentHighlightRun"("channelId", "createdAt");

-- AddForeignKey
ALTER TABLE "YouTubeCommentHighlightRun" ADD CONSTRAINT "YouTubeCommentHighlightRun_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "YouTubeChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
