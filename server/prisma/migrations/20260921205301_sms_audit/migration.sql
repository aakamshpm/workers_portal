-- Enable PostGIS for nearby search (ADR-0002, ST_DWithin).
CREATE EXTENSION IF NOT EXISTS postgis;

-- AlterTable
ALTER TABLE "SmsMessage" ADD COLUMN     "providerId" TEXT,
ADD COLUMN     "status" TEXT;
