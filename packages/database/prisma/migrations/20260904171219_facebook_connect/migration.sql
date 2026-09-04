-- AlterTable
ALTER TABLE "FacebookConnection" ADD COLUMN     "providerUserName" TEXT;

-- AlterTable
ALTER TABLE "FacebookPage" ADD COLUMN     "fanCount" INTEGER,
ADD COLUMN     "lastSyncError" TEXT,
ADD COLUMN     "lastValidatedAt" TIMESTAMP(3),
ADD COLUMN     "link" TEXT,
ADD COLUMN     "profile" JSONB;
