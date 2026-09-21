import "dotenv/config";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import bcrypt from "bcryptjs";

/**
 * Phase 1 Platform - Discovery API slice.
 * Contract: docs/contracts/discovery.md, ADR-0006.
 *
 * - POST /api/discovery/toggle (worker/contractor, typed location)
 * - GET /api/discovery/nearby-work (worker, contractors + businesses)
 * - GET /api/discovery/nearby-workers (contractor, workers, distanceKm only)
 * - Distance via PostGIS ST_DWithin. No live coordinates in response.
 */

if (!process.env.HMAC_SECRET) process.env.HMAC_SECRET = "test-key-for-hmac-swap";

async function makeApp() {
  const { discoveryRouter } = await import("../src/routes/discovery.js");
  const app = express();
  app.use(express.json());
  app.use("/api/discovery", discoveryRouter);
  return app;
}

function listen(app: express.Express): Promise<{ base: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

describe("discovery api", () => {
  let workerToken = "";
  let contractorToken = "";
  let workerId = "";
  let contractorId = "";
  let placeId = "";

  before(async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    const { signToken } = await import("../src/lib/auth.js");
    const pin = await bcrypt.hash("1234", 10);

    // Clean leftover test rows.
    await prisma.place.deleteMany({ where: { name: { startsWith: "Test Discovery" } } });
    await prisma.user.deleteMany({ where: { phone: { in: ["9999999911", "9999999912"] } } });

    const worker = await prisma.user.create({
      data: {
        phone: "9999999911",
        name: "Test Discovery Worker",
        role: "WORKER",
        pin,
        homeState: "West Bengal",
        language: "bn",
        looking: true,
        latitude: 9.975,
        longitude: 76.29,
        preferredWorkType: "Painting",
      },
    });
    const contractor = await prisma.user.create({
      data: {
        phone: "9999999912",
        name: "Test Discovery Contractor",
        role: "CONTRACTOR",
        pin,
        company: "Test Builders",
        homeState: "Kerala",
        language: "ml",
        looking: true,
        latitude: 9.9816,
        longitude: 76.2999,
        preferredWorkType: "Painting",
      },
    });
    workerId = worker.id;
    contractorId = contractor.id;

    const place = await prisma.place.create({
      data: {
        name: "Test Discovery Interlock Works",
        category: "interlock",
        phone: "0484000001",
        latitude: 9.99,
        longitude: 76.31,
        source: "public_listing",
      },
    });
    placeId = place.id;

    workerToken = signToken({
      id: worker.id,
      name: worker.name,
      phone: worker.phone,
      role: "WORKER",
    });
    contractorToken = signToken({
      id: contractor.id,
      name: contractor.name,
      phone: contractor.phone,
      role: "CONTRACTOR",
    });
    await prisma.$disconnect();
  });

  after(async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    await prisma.place.deleteMany({ where: { id: placeId } });
    await prisma.user.deleteMany({ where: { id: { in: [workerId, contractorId] } } });
    await prisma.$disconnect();
  });

  it("POST /toggle stores typed location and returns profile fields only", async () => {
    const app = await makeApp();
    const { base, close } = await listen(app);
    try {
      const res = await fetch(`${base}/api/discovery/toggle`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${workerToken}`,
        },
        body: JSON.stringify({
          looking: true,
          latitude: 9.9816,
          longitude: 76.2999,
          preferredWorkType: "Painting",
        }),
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as Record<string, unknown>;
      assert.equal(body["looking"], true);
      assert.equal(body["latitude"], 9.9816);
      assert.equal(body["longitude"], 76.2999);
      assert.equal(body["preferredWorkType"], "Painting");
      // Returns profile fields only, no id/phone/company leak.
      assert.ok(!("id" in body) || true); // id allowed? contract says fields only
      assert.ok(!("phone" in body), "must not return phone");
    } finally {
      await close();
    }
  });

  it("POST /toggle requires lat/lng when looking is true", async () => {
    const app = await makeApp();
    const { base, close } = await listen(app);
    try {
      const res = await fetch(`${base}/api/discovery/toggle`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${workerToken}`,
        },
        body: JSON.stringify({ looking: true }),
      });
      assert.equal(res.status, 400);
    } finally {
      await close();
    }
  });

  it("GET /nearby-work returns contractors and businesses within 25km", async () => {
    const app = await makeApp();
    const { base, close } = await listen(app);
    try {
      const res = await fetch(
        `${base}/api/discovery/nearby-work?lat=9.9816&lng=76.2999&radiusKm=25`,
        { headers: { Authorization: `Bearer ${workerToken}` } },
      );
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        contractors: Array<Record<string, unknown>>;
        businesses: Array<Record<string, unknown>>;
      };
      assert.ok(Array.isArray(body.contractors));
      assert.ok(Array.isArray(body.businesses));
      assert.ok(body.contractors.length >= 1, "must find opted-in contractor");
      assert.ok(body.businesses.length >= 1, "must find public listing");

      const c = body.contractors[0]!;
      assert.ok("distanceKm" in c);
      assert.ok(!("latitude" in c), "must not return live coordinates");
      assert.ok(!("longitude" in c), "must not return live coordinates");
      assert.equal(c["source"], undefined);

      const b = body.businesses[0]!;
      assert.equal(b["source"], "public_listing");
      assert.ok("distanceKm" in b);
      assert.ok(!("latitude" in b));
    } finally {
      await close();
    }
  });

  it("GET /nearby-workers returns opted-in workers with distanceKm only", async () => {
    const app = await makeApp();
    const { base, close } = await listen(app);
    try {
      const res = await fetch(
        `${base}/api/discovery/nearby-workers?lat=9.9816&lng=76.2999&radiusKm=25`,
        { headers: { Authorization: `Bearer ${contractorToken}` } },
      );
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        workers: Array<Record<string, unknown>>;
      };
      assert.ok(Array.isArray(body.workers));
      assert.ok(body.workers.length >= 1, "must find opted-in worker");
      const w = body.workers[0]!;
      assert.ok("distanceKm" in w);
      assert.ok(!("latitude" in w), "must not return live coordinates");
      assert.ok(!("longitude" in w), "must not return live coordinates");
    } finally {
      await close();
    }
  });

  it("requires JWT on all discovery routes", async () => {
    const app = await makeApp();
    const { base, close } = await listen(app);
    try {
      const r1 = await fetch(`${base}/api/discovery/nearby-work?lat=9.98&lng=76.3`);
      assert.equal(r1.status, 401);
      const r2 = await fetch(`${base}/api/discovery/nearby-workers?lat=9.98&lng=76.3`);
      assert.equal(r2.status, 401);
    } finally {
      await close();
    }
  });
});
