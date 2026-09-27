-- ภาพจริงจากคลังภาพฟรี (Pexels): คีย์ผู้ให้บริการได้หลายเจ้าต่อ workspace (tavily + pexels)
-- อัตโนมัติของห้องข่าวเลือกแหล่งภาพได้ none | stock | ai (เดิมเป็น aiImage true/false — แปลงค่าเดิมให้ครบ)

DROP INDEX "SearchProviderAccount_workspaceId_key";
CREATE UNIQUE INDEX "SearchProviderAccount_workspaceId_provider_key" ON "SearchProviderAccount"("workspaceId", "provider");

ALTER TABLE "NewsAutomation" ADD COLUMN "imageSource" TEXT NOT NULL DEFAULT 'none';
UPDATE "NewsAutomation" SET "imageSource" = 'ai' WHERE "aiImage" = true;
ALTER TABLE "NewsAutomation" DROP COLUMN "aiImage";
