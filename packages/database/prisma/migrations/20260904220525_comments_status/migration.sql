-- AlterTable
ALTER TABLE "FacebookPage" ADD COLUMN     "commentsStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "commentsSyncedAt" TIMESTAMP(3);
