-- Messenger: เลือกต่อเพจว่าให้ AI ร่างรอคนกดส่ง แม้ระบบเปิดส่งอัตโนมัติไว้
ALTER TABLE "MessengerPageConfig" ADD COLUMN "reviewDrafts" BOOLEAN NOT NULL DEFAULT false;
