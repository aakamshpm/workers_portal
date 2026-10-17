-- ADR-0024: count wrong handover codes, so five spend the code.
ALTER TABLE "HandoverCode" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
