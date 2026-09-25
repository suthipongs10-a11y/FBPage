-- CreateTable
CREATE TABLE "YouTubeReport" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "data" JSONB NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "YouTubeReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "YouTubeReport_channelId_createdAt_idx" ON "YouTubeReport"("channelId", "createdAt");

-- AddForeignKey
ALTER TABLE "YouTubeReport" ADD CONSTRAINT "YouTubeReport_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "YouTubeChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

