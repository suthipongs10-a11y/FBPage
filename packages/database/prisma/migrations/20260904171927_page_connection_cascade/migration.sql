-- DropForeignKey
ALTER TABLE "FacebookPage" DROP CONSTRAINT "FacebookPage_connectionId_fkey";

-- AddForeignKey
ALTER TABLE "FacebookPage" ADD CONSTRAINT "FacebookPage_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "FacebookConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
