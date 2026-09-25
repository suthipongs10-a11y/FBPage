-- AiProviderKey (คีย์ได้ใบเดียวต่อชนิด) → AiConnection (ตั้งชื่อเอง ใส่ชนิดเดียวกันกี่ใบก็ได้)
-- ข้อมูลเดิมถูกแปลงให้ครบ: label = ชื่อชนิดเดิม, preset = ชนิดเดิม, บทบาทที่ตั้งไว้ผูกเข้ากับคีย์ใบที่ตรงกัน

ALTER TABLE "AiProviderKey" RENAME TO "AiConnection";
ALTER TABLE "AiConnection" RENAME COLUMN "provider" TO "kind";
ALTER TABLE "AiConnection" ADD COLUMN "preset" TEXT;
ALTER TABLE "AiConnection" ADD COLUMN "models" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- label เดิมเป็น null ได้ — เติมจากชนิด แล้วค่อยบังคับ NOT NULL
UPDATE "AiConnection" SET "label" = "kind" WHERE "label" IS NULL OR btrim("label") = '';
-- preset ต้องเป็น id ที่มีจริงใน PROVIDER_PRESETS — ชนิด compatible ตรงกับ preset ชื่อ "custom"
UPDATE "AiConnection" SET "preset" = CASE WHEN "kind" = 'compatible' THEN 'custom' ELSE "kind" END;
ALTER TABLE "AiConnection" ALTER COLUMN "label" SET NOT NULL;

ALTER INDEX "AiProviderKey_pkey" RENAME TO "AiConnection_pkey";
ALTER TABLE "AiConnection" RENAME CONSTRAINT "AiProviderKey_workspaceId_fkey" TO "AiConnection_workspaceId_fkey";
DROP INDEX "AiProviderKey_workspaceId_provider_key";
CREATE UNIQUE INDEX "AiConnection_workspaceId_label_key" ON "AiConnection"("workspaceId", "label");
CREATE INDEX "AiConnection_workspaceId_kind_idx" ON "AiConnection"("workspaceId", "kind");

-- บทบาทชี้ไปที่คีย์ใบหนึ่ง ไม่ใช่ชนิดอีกต่อไป
ALTER TABLE "AiRoleConfig" ADD COLUMN "connectionId" TEXT;
UPDATE "AiRoleConfig" r SET "connectionId" = c."id"
  FROM "AiConnection" c
  WHERE c."workspaceId" = r."workspaceId" AND c."kind" = r."provider";
-- บทบาทที่ชี้ไปยังชนิดที่ไม่มีคีย์แล้ว ใช้งานไม่ได้อยู่แล้ว (resolve จะข้ามทุกครั้ง) จึงลบทิ้ง
DELETE FROM "AiRoleConfig" WHERE "connectionId" IS NULL;
ALTER TABLE "AiRoleConfig" ALTER COLUMN "connectionId" SET NOT NULL;
ALTER TABLE "AiRoleConfig" DROP COLUMN "provider";
ALTER TABLE "AiRoleConfig" ADD CONSTRAINT "AiRoleConfig_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "AiConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "AiRoleConfig_connectionId_idx" ON "AiRoleConfig"("connectionId");

-- เติมรายชื่อโมเดลของแต่ละคีย์จากบทบาทที่เคยชี้มัน เพื่อให้ dropdown มีตัวเลือกตั้งแต่วันแรก
UPDATE "AiConnection" c SET "models" = sub.models
  FROM (SELECT "connectionId", array_agg(DISTINCT "model") AS models FROM "AiRoleConfig" GROUP BY "connectionId") sub
  WHERE sub."connectionId" = c."id";

-- บันทึกว่าแต่ละงานใช้คีย์ใบไหน (ข้อมูลเก่าเป็น null)
ALTER TABLE "AiTaskLog" ADD COLUMN "connectionId" TEXT;
