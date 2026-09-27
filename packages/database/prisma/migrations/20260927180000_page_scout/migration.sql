-- ผู้ช่วยหาเรื่องโพสต์ต่อเพจ: โปรไฟล์เพจ + ไอเดียที่เหมาะ/เป็นกระแสพร้อมแหล่ง

CREATE TABLE "PageScout" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "facts" JSONB,
    "profile" JSONB,
    "profiledAt" TIMESTAMP(3),
    "ideas" JSONB,
    "ideaSources" JSONB,
    "scoutedAt" TIMESTAMP(3),
    "provider" TEXT,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PageScout_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PageScout_pageId_key" ON "PageScout"("pageId");
ALTER TABLE "PageScout" ADD CONSTRAINT "PageScout_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PageScout" ADD CONSTRAINT "PageScout_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "FacebookPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
