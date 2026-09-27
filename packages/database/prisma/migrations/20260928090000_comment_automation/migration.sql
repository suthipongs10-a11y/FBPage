-- ดูแลคอมเมนต์อัตโนมัติ: ไลค์ / ส่งข้อความเข้าอินบ็อกซ์ (private reply) + ตั้งค่าต่อเพจ (ทุกสวิตช์ค่าเริ่มต้นปิด)

ALTER TABLE "PageComment" ADD COLUMN "likedAt" TIMESTAMP(3);
ALTER TABLE "PageComment" ADD COLUMN "privateReplyText" TEXT;
ALTER TABLE "PageComment" ADD COLUMN "privateReplyStatus" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "PageComment" ADD COLUMN "privateReplyAt" TIMESTAMP(3);
ALTER TABLE "PageComment" ADD COLUMN "privateReplyError" TEXT;
ALTER TABLE "PageComment" ADD COLUMN "privateMessageId" TEXT;
ALTER TABLE "PageComment" ADD COLUMN "autoHandledAt" TIMESTAMP(3);

CREATE TABLE "CommentAutomation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enabledAt" TIMESTAMP(3),
    "autoLike" BOOLEAN NOT NULL DEFAULT false,
    "autoReply" BOOLEAN NOT NULL DEFAULT false,
    "autoPrivateReply" BOOLEAN NOT NULL DEFAULT false,
    "publicAckText" TEXT NOT NULL DEFAULT 'ส่งรายละเอียดให้ทางแชทแล้วนะคะ 😊 เช็คกล่องข้อความได้เลยค่ะ',
    "maxPerRun" INTEGER NOT NULL DEFAULT 20,
    "createdById" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lastResult" JSONB,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommentAutomation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CommentAutomation_pageId_key" ON "CommentAutomation"("pageId");
CREATE INDEX "CommentAutomation_enabled_idx" ON "CommentAutomation"("enabled");
ALTER TABLE "CommentAutomation" ADD CONSTRAINT "CommentAutomation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommentAutomation" ADD CONSTRAINT "CommentAutomation_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "FacebookPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
