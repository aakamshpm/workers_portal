import "./setup";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * The development seed guard. ADR-0014.
 *
 * The seed deletes every user before it writes sample data. Run against a
 * real database, that destroys every worker's ledger, which cannot be
 * rebuilt. These tests guarantee the guard refuses anything that is not a
 * local development database.
 */

describe("seed guard", () => {
  it("allows a database on this machine", async () => {
    const { seedAllowed } = await import("../prisma/seed-guard.js");
    assert.equal(seedAllowed("postgresql://wage:wage@localhost:5432/wage", undefined).ok, true);
    assert.equal(seedAllowed("postgresql://wage:wage@127.0.0.1:5432/wage", "development").ok, true);
  });

  it("refuses a database on another machine, even with the development name", async () => {
    const { seedAllowed } = await import("../prisma/seed-guard.js");
    const r = seedAllowed("postgresql://wage:secret@db.example.com:5432/wage", undefined);
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /localhost/);
  });

  it("refuses to run in production, even on this machine", async () => {
    const { seedAllowed } = await import("../prisma/seed-guard.js");
    const r = seedAllowed("postgresql://wage:wage@localhost:5432/wage", "production");
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /production/);
  });

  it("refuses a missing or unreadable database address", async () => {
    const { seedAllowed } = await import("../prisma/seed-guard.js");
    assert.equal(seedAllowed(undefined, undefined).ok, false);
    assert.equal(seedAllowed("not a url", undefined).ok, false);
  });
});
