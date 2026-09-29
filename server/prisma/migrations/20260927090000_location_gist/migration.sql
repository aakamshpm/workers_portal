-- Nearby search indexes (ADR-0016).
--
-- Expression indexes on the same point the queries compute, so latitude and
-- longitude stay plain columns and Prisma does not change. The query text in
-- src/lib/nearby.ts must use exactly this expression, or PostgreSQL ignores
-- the index and reads every row. test/nearby.test.ts checks the plan.
--
-- User: partial, because only people who opted in are ever searched (ADR-0006).

CREATE INDEX "User_location_gist" ON "User"
  USING GIST ((ST_MakePoint(longitude, latitude)::geography))
  WHERE looking = true AND latitude IS NOT NULL;

CREATE INDEX "Place_location_gist" ON "Place"
  USING GIST ((ST_MakePoint(longitude, latitude)::geography));
