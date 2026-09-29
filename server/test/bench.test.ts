import "./setup";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Search benchmark helpers. ADR-0016.
 *
 * What these tests guarantee:
 * - the benchmark only ever runs against a local database whose name ends in
 *   "_bench", because it drops and recreates that database; it can never
 *   reach the development ledger (wage), the test database (wage_test) or a
 *   database on another machine;
 * - p50 and p95 are computed the usual way (nearest rank), so the numbers in
 *   the report mean what the report says;
 * - the synthetic workers are the same on every run for the same seed, so a
 *   result can be reproduced.
 */

describe("benchTargetAllowed", () => {
  it("accepts a local database whose name ends in _bench", async () => {
    const { benchTargetAllowed } = await import("../scripts/bench-lib.js");
    for (const url of [
      "postgresql://wage:wage@localhost:5432/wage_bench",
      "postgresql://wage:wage@127.0.0.1:5432/search_bench",
    ]) {
      assert.deepEqual(benchTargetAllowed(url, undefined), { ok: true }, url);
    }
  });

  it("refuses the development and test databases", async () => {
    const { benchTargetAllowed } = await import("../scripts/bench-lib.js");
    for (const url of [
      "postgresql://wage:wage@localhost:5432/wage",
      "postgresql://wage:wage@localhost:5432/wage_test",
      "postgresql://wage:wage@localhost:5432/wage_bench_old",
    ]) {
      assert.equal(benchTargetAllowed(url, undefined).ok, false, url);
    }
  });

  it("refuses a database on another machine, even if named _bench", async () => {
    const { benchTargetAllowed } = await import("../scripts/bench-lib.js");
    assert.equal(benchTargetAllowed("postgresql://wage:wage@db.example.org:5432/wage_bench", undefined).ok, false);
  });

  it("refuses when NODE_ENV is production", async () => {
    const { benchTargetAllowed } = await import("../scripts/bench-lib.js");
    assert.equal(benchTargetAllowed("postgresql://wage:wage@localhost:5432/wage_bench", "production").ok, false);
  });

  it("refuses a missing or broken address", async () => {
    const { benchTargetAllowed } = await import("../scripts/bench-lib.js");
    assert.equal(benchTargetAllowed(undefined, undefined).ok, false);
    assert.equal(benchTargetAllowed("not a url", undefined).ok, false);
  });
});

describe("percentile", () => {
  it("uses the nearest-rank method", async () => {
    const { percentile } = await import("../scripts/bench-lib.js");
    const xs = [10, 1, 9, 2, 8, 3, 7, 4, 6, 5]; // 1..10, unsorted on purpose
    assert.equal(percentile(xs, 50), 5);
    assert.equal(percentile(xs, 95), 10);
    assert.equal(percentile(xs, 100), 10);
    assert.equal(percentile([42], 95), 42);
  });

  it("does not reorder the caller's array", async () => {
    const { percentile } = await import("../scripts/bench-lib.js");
    const xs = [3, 1, 2];
    percentile(xs, 50);
    assert.deepEqual(xs, [3, 1, 2]);
  });

  it("refuses an empty list", async () => {
    const { percentile } = await import("../scripts/bench-lib.js");
    assert.throws(() => percentile([], 50));
  });
});

describe("syntheticWorkers", () => {
  const TOWNS = [
    { name: "Kochi", latitude: 9.9679, longitude: 76.2444 },
    { name: "Thrissur", latitude: 10.5276, longitude: 76.2144 },
  ];

  it("is the same for the same seed", async () => {
    const { syntheticWorkers } = await import("../scripts/bench-lib.js");
    assert.deepEqual(syntheticWorkers(TOWNS, 0, 50, 7), syntheticWorkers(TOWNS, 0, 50, 7));
    assert.notDeepEqual(syntheticWorkers(TOWNS, 0, 50, 7), syntheticWorkers(TOWNS, 0, 50, 8));
  });

  it("gives unique 10-digit phones, and places everyone within 0.15 degrees of a town", async () => {
    const { syntheticWorkers } = await import("../scripts/bench-lib.js");
    const rows = [...syntheticWorkers(TOWNS, 0, 500, 1), ...syntheticWorkers(TOWNS, 500, 1000, 1)];
    assert.equal(new Set(rows.map((r) => r.phone)).size, 1000);
    for (const r of rows) {
      assert.match(r.phone, /^\d{10}$/);
      const town = TOWNS.find((t) => t.name === r.locationName)!;
      assert.ok(Math.abs(r.latitude - town.latitude) <= 0.15 && Math.abs(r.longitude - town.longitude) <= 0.15);
    }
  });

  it("makes 1 in 10 a contractor and 4 in 5 opted in, as the report says", async () => {
    const { syntheticWorkers } = await import("../scripts/bench-lib.js");
    const rows = syntheticWorkers(TOWNS, 0, 1000, 3);
    assert.equal(rows.filter((r) => r.role === "CONTRACTOR").length, 100);
    assert.equal(rows.filter((r) => r.looking).length, 800);
  });
});
