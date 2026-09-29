import "./setup";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

/**
 * Nearby search with a spatial index. ADR-0002, ADR-0016.
 *
 * What these tests guarantee:
 * - haversineKm, the brute-force baseline in the benchmark, gives the right
 *   distance on a known pair of Kerala towns;
 * - the nearby queries use the GiST index to cut down the rows by the
 *   radius (an "Index Cond" with the bounding-box operator &&), not only to
 *   walk the index in distance order. A query whose point expression differs
 *   from the index, or that filters with ST_Distance(...) < r, still names the
 *   index in its plan but reads every entry, so naming the index is not enough;
 * - the query with the index returns exactly the workers that the
 *   brute-force Haversine formula finds inside the radius, nearest first, with
 *   the same distance within 0.6%. PostGIS measures on the WGS 84 spheroid and
 *   Haversine on a sphere of the mean radius (6371 km). At Kerala's latitude
 *   the spheroid's north-south radius of curvature is about 6337 km, so a
 *   north-south distance comes out up to about 0.53% shorter in PostGIS;
 * - a worker who has not opted in is never returned (ADR-0006).
 *
 * Runs against wage_test. The rows it adds are removed afterwards.
 */

const KAKKANAD = { lat: 10.0159, lng: 76.3419 };
const ALUVA = { lat: 10.1076, lng: 76.3516 };
const KOCHI = { lat: 9.9679, lng: 76.2444 };

/** Largest relative gap between Haversine and PostGIS geography here (see above). */
const SPHEROID_GAP = 0.006;

const PREFIX = "96000"; // test phones 9600000000 … 9600000299
const COUNT = 300;

/** A repeatable pseudo-random sequence, so a failure can be reproduced. */
function random(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

describe("haversineKm", () => {
  it("measures Kakkanad to Aluva as about 10.25 km", async () => {
    const { haversineKm } = await import("../src/lib/nearby.js");
    const d = haversineKm(KAKKANAD.lat, KAKKANAD.lng, ALUVA.lat, ALUVA.lng);
    assert.ok(Math.abs(d - 10.25) < 0.02, `got ${d}`);
  });

  it("is zero for the same point and the same in both directions", async () => {
    const { haversineKm } = await import("../src/lib/nearby.js");
    assert.equal(haversineKm(KOCHI.lat, KOCHI.lng, KOCHI.lat, KOCHI.lng), 0);
    assert.equal(
      haversineKm(KOCHI.lat, KOCHI.lng, ALUVA.lat, ALUVA.lng),
      haversineKm(ALUVA.lat, ALUVA.lng, KOCHI.lat, KOCHI.lng),
    );
  });
});

describe("nearby queries", () => {
  const points: { id: string; lat: number; lng: number; looking: boolean }[] = [];

  before(async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    await prisma.user.deleteMany({ where: { phone: { startsWith: PREFIX } } });

    // Workers spread up to about 60 km around Kochi, so a 25 km search has
    // points inside, outside and near the edge. Every tenth has not opted in.
    const next = random(42);
    const data = Array.from({ length: COUNT }, (_, i) => ({
      phone: `${PREFIX}${String(i).padStart(5, "0")}`,
      name: `Test Nearby ${i}`,
      role: "WORKER",
      looking: i % 10 !== 0,
      latitude: KOCHI.lat + (next() - 0.5) * 1.1,
      longitude: KOCHI.lng + (next() - 0.5) * 1.1,
    }));
    await prisma.user.createMany({ data });
    const rows = await prisma.user.findMany({
      where: { phone: { startsWith: PREFIX } },
      select: { id: true, latitude: true, longitude: true, looking: true },
    });
    for (const r of rows) points.push({ id: r.id, lat: r.latitude!, lng: r.longitude!, looking: r.looking });
  });

  after(async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    await prisma.user.deleteMany({ where: { phone: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  /**
   * The index is used for the radius itself: the plan scans it with a
   * bounding-box condition (&&), so rows far away are never read.
   */
  function assertRadiusUsesIndex(plan: string, index: string) {
    const lines = plan.split("\n");
    const scan = lines.findIndex((l) => l.includes(`Index Scan using "${index}"`));
    assert.ok(scan >= 0, `plan does not use ${index}:\n${plan}`);
    const cond = lines.slice(scan + 1).find((l) => /Index Cond:/.test(l));
    assert.ok(cond && /&&/.test(cond), `${index} is not used to limit by radius (no Index Cond with &&):\n${plan}`);
  }

  /** The plan PostgreSQL would use, with plain table scans switched off. */
  async function planWithoutSeqScan(query: unknown): Promise<string> {
    const { prisma } = await import("../src/lib/prisma.js");
    const { Prisma } = await import("../generated/prisma/client.js");
    const q = query as InstanceType<typeof Prisma.Sql>;
    return prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
      const rows = (await tx.$queryRaw(Prisma.sql`EXPLAIN ${q}`)) as { "QUERY PLAN": string }[];
      return rows.map((r) => r["QUERY PLAN"]).join("\n");
    });
  }

  it("the worker and contractor search uses the User GiST index", async () => {
    const { nearbyUsersSql } = await import("../src/lib/nearby.js");
    for (const role of ["WORKER", "CONTRACTOR"] as const) {
      const plan = await planWithoutSeqScan(
        nearbyUsersSql({ role, lat: KOCHI.lat, lng: KOCHI.lng, radiusM: 25_000 }),
      );
      assertRadiusUsesIndex(plan, "User_location_gist");
    }
  });

  it("the work-type filter still uses the User GiST index", async () => {
    const { nearbyUsersSql } = await import("../src/lib/nearby.js");
    const plan = await planWithoutSeqScan(
      nearbyUsersSql({ role: "WORKER", lat: KOCHI.lat, lng: KOCHI.lng, radiusM: 25_000, workType: "Painting" }),
    );
    assertRadiusUsesIndex(plan, "User_location_gist");
  });

  it("the business listing search uses the Place GiST index", async () => {
    const { nearbyPlacesSql } = await import("../src/lib/nearby.js");
    const plan = await planWithoutSeqScan(nearbyPlacesSql({ lat: KOCHI.lat, lng: KOCHI.lng, radiusM: 25_000 }));
    assertRadiusUsesIndex(plan, "Place_location_gist");
  });

  it("returns exactly the opted-in workers Haversine finds in the radius, nearest first", async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    const { haversineKm, nearbyUsersSql } = await import("../src/lib/nearby.js");
    const radiusKm = 25;

    const got = (await prisma.$queryRaw(
      nearbyUsersSql({ role: "WORKER", lat: KOCHI.lat, lng: KOCHI.lng, radiusM: radiusKm * 1000, limit: 1000 }),
    )) as { id: string; distanceKm: number }[];
    const mine = got.filter((r) => points.some((p) => p.id === r.id));

    // Leave out the thin band at the edge where sphere and spheroid disagree.
    const band = radiusKm * SPHEROID_GAP;
    const expected = points
      .filter((p) => p.looking)
      .map((p) => ({ id: p.id, d: haversineKm(KOCHI.lat, KOCHI.lng, p.lat, p.lng) }))
      .filter((p) => Math.abs(p.d - radiusKm) > band);
    const inside = new Set(expected.filter((p) => p.d < radiusKm).map((p) => p.id));
    const outside = new Set(expected.filter((p) => p.d > radiusKm).map((p) => p.id));

    assert.ok(inside.size > 20 && outside.size > 20, "test data must have points on both sides");
    for (const id of inside) assert.ok(mine.some((r) => r.id === id), `missing a worker inside the radius`);
    for (const r of mine) assert.ok(!outside.has(r.id), `returned a worker outside the radius`);

    const notLooking = new Set(points.filter((p) => !p.looking).map((p) => p.id));
    assert.ok(!mine.some((r) => notLooking.has(r.id)), "returned a worker who has not opted in");

    for (let i = 1; i < mine.length; i++) {
      assert.ok(Number(mine[i]!.distanceKm) >= Number(mine[i - 1]!.distanceKm), "not ordered nearest first");
    }
    for (const r of mine) {
      const p = points.find((q) => q.id === r.id)!;
      const h = haversineKm(KOCHI.lat, KOCHI.lng, p.lat, p.lng);
      assert.ok(Math.abs(Number(r.distanceKm) - h) <= h * SPHEROID_GAP + 0.001, `distance ${r.distanceKm} vs ${h}`);
    }
  });
});
