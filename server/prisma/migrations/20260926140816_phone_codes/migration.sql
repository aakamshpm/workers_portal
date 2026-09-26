-- AlterTable
ALTER TABLE "User" ALTER COLUMN "pin" DROP NOT NULL;

-- CreateTable
CREATE TABLE "PhoneCode" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhoneCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhoneCode_phone_purpose_idx" ON "PhoneCode"("phone", "purpose");

-- CreateIndex
CREATE INDEX "PhoneCode_phone_createdAt_idx" ON "PhoneCode"("phone", "createdAt");
