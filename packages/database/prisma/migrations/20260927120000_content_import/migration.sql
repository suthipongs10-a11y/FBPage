-- นำเข้าคอนเทนต์จาก AI ภายนอก (แพ็กเกจ fbpm-content-v1): กล่องรับต่อแบรนด์ + ประวัติการนำเข้าพร้อมผลตรวจ

CREATE TABLE "ContentInbox" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "pageId" TEXT,
    "theme" TEXT NOT NULL DEFAULT 'dark',
    "imageFallback" TEXT NOT NULL DEFAULT 'stock',
    "autoDraft" BOOLEAN NOT NULL DEFAULT true,
    "keyHash" TEXT,
    "keyHint" TEXT,
    "keyCreatedAt" TIMESTAMP(3),
    "driveEnabled" BOOLEAN NOT NULL DEFAULT false,
    "driveFolderId" TEXT,
    "driveClientEmail" TEXT,
    "driveCredentialsEnc" TEXT,
    "driveLastPolledAt" TIMESTAMP(3),
    "driveLastError" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContentInbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ContentInbox_brandId_key" ON "ContentInbox"("brandId");
CREATE UNIQUE INDEX "ContentInbox_keyHash_key" ON "ContentInbox"("keyHash");
CREATE INDEX "ContentInbox_driveEnabled_idx" ON "ContentInbox"("driveEnabled");
ALTER TABLE "ContentInbox" ADD CONSTRAINT "ContentInbox_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentInbox" ADD CONSTRAINT "ContentInbox_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ContentImport" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "externalId" TEXT,
    "fileName" TEXT,
    "status" TEXT NOT NULL,
    "postCount" INTEGER NOT NULL DEFAULT 0,
    "draftCount" INTEGER NOT NULL DEFAULT 0,
    "report" JSONB NOT NULL,
    "payload" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContentImport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ContentImport_workspaceId_channel_externalId_key" ON "ContentImport"("workspaceId", "channel", "externalId");
CREATE INDEX "ContentImport_brandId_createdAt_idx" ON "ContentImport"("brandId", "createdAt");
ALTER TABLE "ContentImport" ADD CONSTRAINT "ContentImport_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentImport" ADD CONSTRAINT "ContentImport_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
