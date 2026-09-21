-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "pin" TEXT NOT NULL,
    "homeState" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "company" TEXT,
    "selfRegistered" BOOLEAN NOT NULL DEFAULT false,
    "looking" BOOLEAN NOT NULL DEFAULT false,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "preferredWorkType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOffer" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "dailyRate" DOUBLE PRECISION NOT NULL,
    "workType" TEXT NOT NULL,
    "siteName" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "expectedDays" INTEGER NOT NULL,
    "extraTerms" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "respondedVia" TEXT,
    "declineReason" TEXT,

    CONSTRAINT "WorkOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkPeriod" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3) NOT NULL,
    "days" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmState" TEXT NOT NULL DEFAULT 'WAITING',
    "confirmedAt" TIMESTAMP(3),
    "confirmedVia" TEXT,
    "workerClaimsDays" DOUBLE PRECISION,
    "disputeNote" TEXT,

    CONSTRAINT "WorkPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paidOn" TIMESTAMP(3) NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'CASH',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "proofType" TEXT NOT NULL DEFAULT 'NONE',
    "proofReference" TEXT,
    "proofAt" TIMESTAMP(3),
    "confirmState" TEXT NOT NULL DEFAULT 'WAITING',
    "confirmedAt" TIMESTAMP(3),
    "confirmedVia" TEXT,
    "workerClaimsAmount" DOUBLE PRECISION,
    "disputeNote" TEXT,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "chainIndex" INTEGER NOT NULL,
    "recordType" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previousHash" TEXT NOT NULL,
    "currentHash" TEXT NOT NULL,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "bodyEn" TEXT,
    "reference" TEXT,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Complaint" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "raisedById" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "claimedAmount" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" TEXT,
    "outcomeNote" TEXT,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Complaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplaintAction" (
    "id" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "escalatedTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplaintAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandoverCode" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "paymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HandoverCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployerStatement" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployerStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisputeReview" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "officerId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputeReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Place" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "phone" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'public_listing',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Place_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE INDEX "WorkOffer_workerId_idx" ON "WorkOffer"("workerId");

-- CreateIndex
CREATE INDEX "WorkOffer_contractorId_idx" ON "WorkOffer"("contractorId");

-- CreateIndex
CREATE INDEX "WorkOffer_status_idx" ON "WorkOffer"("status");

-- CreateIndex
CREATE INDEX "WorkPeriod_offerId_idx" ON "WorkPeriod"("offerId");

-- CreateIndex
CREATE INDEX "WorkPeriod_confirmState_idx" ON "WorkPeriod"("confirmState");

-- CreateIndex
CREATE INDEX "Payment_offerId_idx" ON "Payment"("offerId");

-- CreateIndex
CREATE INDEX "Payment_confirmState_idx" ON "Payment"("confirmState");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_chainIndex_key" ON "LedgerEntry"("chainIndex");

-- CreateIndex
CREATE INDEX "LedgerEntry_workerId_idx" ON "LedgerEntry"("workerId");

-- CreateIndex
CREATE INDEX "LedgerEntry_recordType_idx" ON "LedgerEntry"("recordType");

-- CreateIndex
CREATE INDEX "SmsMessage_userId_idx" ON "SmsMessage"("userId");

-- CreateIndex
CREATE INDEX "Complaint_status_idx" ON "Complaint"("status");

-- CreateIndex
CREATE INDEX "Complaint_offerId_idx" ON "Complaint"("offerId");

-- CreateIndex
CREATE INDEX "ComplaintAction_complaintId_idx" ON "ComplaintAction"("complaintId");

-- CreateIndex
CREATE INDEX "HandoverCode_workerId_idx" ON "HandoverCode"("workerId");

-- CreateIndex
CREATE INDEX "HandoverCode_contractorId_idx" ON "HandoverCode"("contractorId");

-- CreateIndex
CREATE INDEX "HandoverCode_code_idx" ON "HandoverCode"("code");

-- CreateIndex
CREATE INDEX "EmployerStatement_offerId_idx" ON "EmployerStatement"("offerId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployerStatement_targetType_targetId_key" ON "EmployerStatement"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "DisputeReview_offerId_idx" ON "DisputeReview"("offerId");

-- CreateIndex
CREATE UNIQUE INDEX "DisputeReview_targetType_targetId_key" ON "DisputeReview"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "Place_category_idx" ON "Place"("category");

-- AddForeignKey
ALTER TABLE "WorkOffer" ADD CONSTRAINT "WorkOffer_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOffer" ADD CONSTRAINT "WorkOffer_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPeriod" ADD CONSTRAINT "WorkPeriod_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "WorkOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "WorkOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "WorkOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplaintAction" ADD CONSTRAINT "ComplaintAction_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplaintAction" ADD CONSTRAINT "ComplaintAction_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployerStatement" ADD CONSTRAINT "EmployerStatement_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "WorkOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployerStatement" ADD CONSTRAINT "EmployerStatement_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeReview" ADD CONSTRAINT "DisputeReview_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "WorkOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeReview" ADD CONSTRAINT "DisputeReview_officerId_fkey" FOREIGN KEY ("officerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
