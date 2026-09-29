-- ความเห็นที่ยังรอช่องตอบ (รวม reply ในเธรด)
ALTER TABLE "YouTubeComment" ADD COLUMN "needsReply" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "YouTubeComment_channelId_needsReply_idx" ON "YouTubeComment"("channelId", "needsReply");
