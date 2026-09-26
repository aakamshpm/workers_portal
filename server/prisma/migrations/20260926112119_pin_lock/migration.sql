-- AlterTable
ALTER TABLE "User" ADD COLUMN     "failedPinCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3);
