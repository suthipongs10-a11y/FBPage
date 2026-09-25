-- Brand-owned drafts can be prepared before TikTok OAuth is configured.
ALTER TABLE "ContentItem" ADD COLUMN "tiktokBrandId" TEXT;
UPDATE "ContentItem" AS c SET "tiktokBrandId" = a."brandId"
FROM "TikTokAccount" AS a WHERE c."platform" = 'TIKTOK' AND c."tiktokAccountId" = a."id";
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_tiktokBrandId_fkey"
FOREIGN KEY ("tiktokBrandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
