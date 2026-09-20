-- CreateTable
CREATE TABLE "MessengerSettings" (
    "workspaceId" TEXT NOT NULL,
    "encryptedApiKey" TEXT NOT NULL,
    "keyHint" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dailyLimit" INTEGER NOT NULL DEFAULT 500,
    "validatedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessengerSettings_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateTable
CREATE TABLE "MessengerDailyUsage" (
    "workspaceId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MessengerDailyUsage_pkey" PRIMARY KEY ("workspaceId","day")
);

-- CreateTable
CREATE TABLE "MessengerPageConfig" (
    "pageId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enabledAt" TIMESTAMP(3),
    "instructions" TEXT NOT NULL DEFAULT '',
    "fallbackMessage" TEXT NOT NULL DEFAULT 'ได้รับข้อความแล้วค่ะ ขณะนี้ยังตรวจสอบคำตอบให้ไม่ได้ กรุณาฝากรายละเอียดเพิ่มเติม ทีมงานจะเข้ามาดูแลต่อค่ะ',
    "subscribedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessengerPageConfig_pkey" PRIMARY KEY ("pageId")
);

-- CreateTable
CREATE TABLE "MessengerConversation" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "psid" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'AUTO',
    "latestInboundId" TEXT,
    "lastCustomerAt" TIMESTAMP(3),
    "needsAttention" BOOLEAN NOT NULL DEFAULT false,
    "lastError" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessengerConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessengerMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "unsupported" BOOLEAN NOT NULL DEFAULT false,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "replyText" TEXT,
    "replyAction" TEXT,
    "replyMessageId" TEXT,
    "error" TEXT,
    "processingAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessengerMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessengerConversation_pageId_updatedAt_idx" ON "MessengerConversation"("pageId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MessengerConversation_pageId_psid_key" ON "MessengerConversation"("pageId", "psid");

-- CreateIndex
CREATE INDEX "MessengerMessage_status_updatedAt_idx" ON "MessengerMessage"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "MessengerMessage_conversationId_occurredAt_idx" ON "MessengerMessage"("conversationId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "MessengerMessage_conversationId_externalId_key" ON "MessengerMessage"("conversationId", "externalId");

-- AddForeignKey
ALTER TABLE "MessengerSettings" ADD CONSTRAINT "MessengerSettings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessengerDailyUsage" ADD CONSTRAINT "MessengerDailyUsage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessengerPageConfig" ADD CONSTRAINT "MessengerPageConfig_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "FacebookPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessengerConversation" ADD CONSTRAINT "MessengerConversation_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "FacebookPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessengerMessage" ADD CONSTRAINT "MessengerMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "MessengerConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
