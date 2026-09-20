-- Messenger ใช้ key/โมเดล AI กลางของพื้นที่ทำงาน (บทบาท community) แทนคีย์ส่วนตัวของโมดูล
-- แถวที่เคยผูกกับคีย์เดิมต้องทดลองคำตอบใหม่ก่อนเปิดตอบอัตโนมัติ และเพจที่เปิดอยู่ถูกปิดไว้ก่อนเพื่อความปลอดภัย
UPDATE "MessengerPageConfig" SET "enabled" = false, "revision" = "revision" + 1 WHERE "enabled" = true;
UPDATE "MessengerSettings" SET "validatedAt" = NULL, "revision" = "revision" + 1;

ALTER TABLE "MessengerSettings" DROP COLUMN "encryptedApiKey";
ALTER TABLE "MessengerSettings" DROP COLUMN "keyHint";
ALTER TABLE "MessengerSettings" DROP COLUMN "model";
