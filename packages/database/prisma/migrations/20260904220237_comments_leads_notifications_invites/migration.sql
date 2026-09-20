-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "notifyWebhookEncrypted" TEXT,
ADD COLUMN     "notifyWebhookHint" TEXT;

-- CreateTable
CREATE TABLE "WorkspaceInvite" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT,
    "role" "WorkspaceRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordReset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "href" TEXT,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageComment" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "postId" TEXT,
    "facebookCommentId" TEXT NOT NULL,
    "parentCommentId" TEXT,
    "fromId" TEXT,
    "fromName" TEXT,
    "message" TEXT,
    "createdTime" TIMESTAMP(3) NOT NULL,
    "permalink" TEXT,
    "classification" TEXT,
    "sentiment" TEXT,
    "riskFlag" BOOLEAN NOT NULL DEFAULT false,
    "aiSummary" TEXT,
    "draftReply" TEXT,
    "replyStatus" TEXT NOT NULL DEFAULT 'NONE',
    "replyExternalId" TEXT,
    "repliedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PageComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "commentId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'comment',
    "name" TEXT,
    "intent" TEXT,
    "product" TEXT,
    "service" TEXT,
    "quantity" TEXT,
    "requestedDate" TEXT,
    "location" TEXT,
    "budget" TEXT,
    "phone" TEXT,
    "urgency" TEXT,
    "leadScore" INTEGER NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceInvite_tokenHash_key" ON "WorkspaceInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "WorkspaceInvite_workspaceId_idx" ON "WorkspaceInvite"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordReset_tokenHash_key" ON "PasswordReset"("tokenHash");

-- CreateIndex
CREATE INDEX "Notification_workspaceId_readAt_createdAt_idx" ON "Notification"("workspaceId", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_workspaceId_dedupeKey_key" ON "Notification"("workspaceId", "dedupeKey");

-- CreateIndex
CREATE INDEX "PageComment_pageId_createdTime_idx" ON "PageComment"("pageId", "createdTime");

-- CreateIndex
CREATE INDEX "PageComment_pageId_replyStatus_idx" ON "PageComment"("pageId", "replyStatus");

-- CreateIndex
CREATE UNIQUE INDEX "PageComment_pageId_facebookCommentId_key" ON "PageComment"("pageId", "facebookCommentId");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_commentId_key" ON "Lead"("commentId");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_status_createdAt_idx" ON "Lead"("workspaceId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "WorkspaceInvite" ADD CONSTRAINT "WorkspaceInvite_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageComment" ADD CONSTRAINT "PageComment_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "FacebookPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageComment" ADD CONSTRAINT "PageComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "FacebookPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "FacebookPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "PageComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
