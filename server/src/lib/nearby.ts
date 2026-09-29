import { Prisma } from "../../generated/prisma/client";

/**
 * ===========================================================================
 * Nearby search. ADR-0006, ADR-0016.
 * ===========================================================================
 *
 * The routes in routes/discovery.ts call these builders, so the SQL is written
 * once. That matters here more than usual: PostgreSQL uses a GiST index only
 * when the query contains exactly the expression the index was built on,
 *
 *     ST_MakePoint(longitude, latitude)::geography
 *
 * and a query that differs in any detail, even the order of the arguments,
 * silently falls back to reading every row. test/nearby.test.ts checks the
 * plan of each query here names the index.
 *
 * How one search runs:
 *   1. The GiST index (an R-tree) keeps only the entries whose bounding box
 *      overlaps a box of the radius around the centre. Most rows are never
 *      read.
 *   2. For those candidates only, ST_DWithin computes the exact distance on
 *      the WGS 84 spheroid and keeps the ones within the radius.
 *   3. The <-> operator orders them nearest first, using the same index.
 */

/** The expression both indexes are built on. Do not change one without the other. */
const POINT = Prisma.sql`ST_MakePoint(longitude, latitude)::geography`;

function centre(lat: number, lng: number) {
  return Prisma.sql`ST_MakePoint(${lng}, ${lat})::geography`;
}

export interface NearbyUsersInput {
  role: "WORKER" | "CONTRACTOR";
  lat: number;
  lng: number;
  radiusM: number;
  /** Case-insensitive part of preferredWorkType. */
  workType?: string;
  limit?: number;
}

/**
 * Opted-in workers or contractors within radiusM of a point, nearest first.
 *
 * The WHERE clause repeats the index's own condition (looking = true and
 * latitude IS NOT NULL), because the planner uses a partial index only when
 * the query's WHERE clause implies the index's.
 */
export function nearbyUsersSql({ role, lat, lng, radiusM, workType, limit = 50 }: NearbyUsersInput) {
  const c = centre(lat, lng);
  const work = workType ? Prisma.sql`AND "preferredWorkType" ILIKE ${`%${workType}%`}` : Prisma.empty;
  return Prisma.sql`
    SELECT id, name, phone, company, "homeState", "preferredWorkType",
      ST_Distance(${POINT}, ${c}) / 1000.0 AS "distanceKm"
    FROM "User"
    WHERE looking = true
      AND latitude IS NOT NULL
      AND role = ${role}
      ${work}
      AND ST_DWithin(${POINT}, ${c}, ${radiusM})
    ORDER BY ${POINT} <-> ${c}
    LIMIT ${limit}
  `;
}

export interface NearbyPlacesInput {
  lat: number;
  lng: number;
  radiusM: number;
  limit?: number;
}

/** Public business listings within radiusM of a point, nearest first. */
export function nearbyPlacesSql({ lat, lng, radiusM, limit = 50 }: NearbyPlacesInput) {
  const c = centre(lat, lng);
  return Prisma.sql`
    SELECT id, name, category, phone, source,
      ST_Distance(${POINT}, ${c}) / 1000.0 AS "distanceKm"
    FROM "Place"
    WHERE ST_DWithin(${POINT}, ${c}, ${radiusM})
    ORDER BY ${POINT} <-> ${c}
    LIMIT ${limit}
  `;
}

/** Mean Earth radius in km (IUGG), the usual value for Haversine. */
const EARTH_RADIUS_KM = 6371.0088;

/**
 * Great-circle distance in km between two points, by the Haversine formula.
 *
 *   a = sin²(Δφ/2) + cos φ1 · cos φ2 · sin²(Δλ/2)
 *   d = 2R · asin(√a)
 *
 * φ is latitude and λ longitude, in radians. This treats the Earth as a
 * sphere, so it differs from PostGIS geography (a spheroid) by up to about
 * 0.5%. The routes do not use it. It is the brute-force baseline in the
 * benchmark (scripts/bench-search.ts), and a check in the tests.
 */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const dPhi = (lat2 - lat1) * rad;
  const dLambda = (lng2 - lng1) * rad;
  const a =
    Math.sin(dPhi / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}
