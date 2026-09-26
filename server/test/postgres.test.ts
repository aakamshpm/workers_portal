import "./setup";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Phase 1 Platform - Postgres + PostGIS slice.
 *
 * Contract:
 * - ADR-0002: provider is postgresql, local DB runs in Docker.
 * - setup-postgres skill: User has latitude, longitude, looking flag,
 *   preferredWorkType; Place model exists for public listings; PostGIS
 *   extension is enabled; seed keeps seven people with Ernakulam coordinates.
 *
 * These tests use the real Postgres database, because distance queries
 * only have meaning on Postgres + PostGIS.
 */

describe("postgres platform", () => {
  it("uses a postgres DATABASE_URL", () => {
    const url = process.env.DATABASE_URL ?? "";
    assert.ok(
      url.startsWith("postgresql://"),
      `DATABASE_URL must start with postgresql://, got ${url.slice(0, 20)}`,
    );
  });

  it("connects to Postgres and finds the PostGIS extension", async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    try {
      const rows = (await prisma.$queryRaw`
        SELECT extname FROM pg_extension WHERE extname = 'postgis'
      `) as { extname: string }[];
      assert.equal(rows.length, 1, "PostGIS extension must be enabled");
    } finally {
      await prisma.$disconnect();
    }
  });

  it("User has discovery fields (looking, latitude, longitude, preferredWorkType)", async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    try {
      // If the schema does not have these fields, this create will throw,
      // which is the correct red state for this slice.
      const u = await prisma.user.create({
        data: {
          phone: "9999999901",
          name: "Postgres Check Worker",
          role: "WORKER",
          pin: "hashed",
          looking: true,
          latitude: 9.9816,
          longitude: 76.2999,
          preferredWorkType: "Painting",
        },
      });
      assert.equal(u.looking, true);
      assert.equal(u.latitude, 9.9816);
      await prisma.user.delete({ where: { id: u.id } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("Place table exists for public listings", async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    try {
      const p = await prisma.place.create({
        data: {
          name: "Example Interlock Works",
          category: "interlock",
          phone: "0484000000",
          latitude: 9.99,
          longitude: 76.31,
          source: "public_listing",
        },
      });
      assert.equal(p.source, "public_listing");
      await prisma.place.delete({ where: { id: p.id } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("supports ST_DWithin for nearby search", async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    try {
      const rows = (await prisma.$queryRaw`
        SELECT ST_DWithin(
          ST_MakePoint(76.2999, 9.9816)::geography,
          ST_MakePoint(76.31, 9.99)::geography,
          25000
        ) AS within
      `) as { within: boolean }[];
      assert.equal(rows[0]?.within, true);
    } finally {
      await prisma.$disconnect();
    }
  });
});
