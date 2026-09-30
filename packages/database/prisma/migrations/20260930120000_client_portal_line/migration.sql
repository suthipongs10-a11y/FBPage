-- พอร์ทัลลูกค้า + แจ้งเตือน LINE OA
-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "inboxDigestAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "clientId" TEXT;

-- CreateTable
CREATE TABLE "ClientPortalMember" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "canReply" BOOLEAN NOT NULL DEFAULT true,
    "canApprove" BOOLEAN NOT NULL DEFAULT true,
    "invitedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientPortalMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientPortalInvite" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "email" TEXT,
    "tokenHash" TEXT NOT NULL,
    "canReply" BOOLEAN NOT NULL DEFAULT true,
    "canApprove" BOOLEAN NOT NULL DEFAULT true,
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientPortalInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineChannel" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channelSecretEncrypted" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT NOT NULL,
    "botBasicId" TEXT,
    "botName" TEXT,
    "webhookKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LineChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineRecipient" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "lineUserId" TEXT NOT NULL,
    "displayName" TEXT,
    "userId" TEXT,
    "clientId" TEXT,
    "types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LineRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineLinkCode" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LineLinkCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineDelivery" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "recipientId" TEXT,
    "notificationId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LineDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientPortalMember_userId_idx" ON "ClientPortalMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientPortalMember_clientId_userId_key" ON "ClientPortalMember"("clientId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientPortalInvite_tokenHash_key" ON "ClientPortalInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "ClientPortalInvite_clientId_idx" ON "ClientPortalInvite"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "LineChannel_workspaceId_key" ON "LineChannel"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "LineChannel_webhookKey_key" ON "LineChannel"("webhookKey");

-- CreateIndex
CREATE INDEX "LineRecipient_workspaceId_active_idx" ON "LineRecipient"("workspaceId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "LineRecipient_workspaceId_lineUserId_clientId_key" ON "LineRecipient"("workspaceId", "lineUserId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "LineLinkCode_workspaceId_code_key" ON "LineLinkCode"("workspaceId", "code");

-- CreateIndex
CREATE INDEX "LineDelivery_workspaceId_createdAt_idx" ON "LineDelivery"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "LineDelivery_recipientId_createdAt_idx" ON "LineDelivery"("recipientId", "createdAt");

-- AddForeignKey
ALTER TABLE "ClientPortalMember" ADD CONSTRAINT "ClientPortalMember_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientPortalMember" ADD CONSTRAINT "ClientPortalMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientPortalInvite" ADD CONSTRAINT "ClientPortalInvite_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineChannel" ADD CONSTRAINT "LineChannel_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineRecipient" ADD CONSTRAINT "LineRecipient_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

