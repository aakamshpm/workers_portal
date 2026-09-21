-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "pin" TEXT NOT NULL,
    "homeState" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "company" TEXT,
    "selfRegistered" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "WorkOffer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workerId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "dailyRate" REAL NOT NULL,
    "workType" TEXT NOT NULL,
    "siteName" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "expectedDays" INTEGER NOT NULL,
    "extraTerms" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" DATETIME,
    "respondedVia" TEXT,
    "declineReason" TEXT,
    CONSTRAINT "WorkOffer_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorkOffer_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkPeriod" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "offerId" TEXT NOT NULL,
    "fromDate" DATETIME NOT NULL,
    "toDate" DATETIME NOT NULL,
    "days" REAL NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmState" TEXT NOT NULL DEFAULT 'WAITING',
    "confirmedAt" DATETIME,
    "confirmedVia" TEXT,
    "workerClaimsDays" REAL,
    "disputeNote" TEXT,
    CONSTRAINT "WorkPeriod_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "WorkOffer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "offerId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "paidOn" DATETIME NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'CASH',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "proofType" TEXT NOT NULL DEFAULT 'NONE',
    "proofReference" TEXT,
    "proofAt" DATETIME,
    "confirmState" TEXT NOT NULL DEFAULT 'WAITING',
    "confirmedAt" DATETIME,
    "confirmedVia" TEXT,
    "workerClaimsAmount" REAL,
    "disputeNote" TEXT,
    CONSTRAINT "Payment_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "WorkOffer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chainIndex" INTEGER NOT NULL,
    "recordType" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previousHash" TEXT NOT NULL,
    "currentHash" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "SmsMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "bodyEn" TEXT,
    "reference" TEXT,
    "kind" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SmsMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Complaint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "offerId" TEXT NOT NULL,
    "raisedById" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "claimedAmount" REAL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" TEXT,
    "outcomeNote" TEXT,
    "closedAt" DATETIME,
    CONSTRAINT "Complaint_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "WorkOffer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Complaint_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ComplaintAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "complaintId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "escalatedTo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ComplaintAction_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ComplaintAction_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HandoverCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "offerId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "paymentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "EmployerStatement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmployerStatement_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "WorkOffer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EmployerStatement_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DisputeReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "officerId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DisputeReview_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "WorkOffer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DisputeReview_officerId_fkey" FOREIGN KEY ("officerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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
