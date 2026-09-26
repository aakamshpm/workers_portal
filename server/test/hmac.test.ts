import "./setup";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";

/**
 * Phase 1 Platform - HMAC slice (ADR-0004).
 *
 * Contract:
 * - computeHash is HMAC-SHA-256 with HMAC_SECRET, not plain SHA-256.
 * - Missing key fails, never uses an empty key.
 * - canonicalPayload and rebuildPayload do not change.
 * - Existing chain tests still pass with the key present.
 */

describe("hmac", () => {
  it("uses HMAC-SHA-256 with HMAC_SECRET, not plain SHA-256", async () => {
    process.env.HMAC_SECRET = "test-key-for-hmac-swap";
    const { computeHash } = await import("../src/lib/hashChain.js");

    const got = computeHash("0", "OFFER|test");
    const plain = createHash("sha256").update("0|OFFER|test", "utf8").digest("hex");
    const hmac = createHmac("sha256", "test-key-for-hmac-swap")
      .update("0|OFFER|test", "utf8")
      .digest("hex");

    assert.notEqual(got, plain, "must not be plain SHA-256");
    assert.equal(got, hmac, "must equal HMAC-SHA-256 with HMAC_SECRET");
  });

  it("changes output when the key changes", async () => {
    process.env.HMAC_SECRET = "key-one";
    const { computeHash } = await import("../src/lib/hashChain.js");
    const a = computeHash("0", "OFFER|test");

    process.env.HMAC_SECRET = "key-two";
    // Re-import to avoid module cache hiding env change? computeHash reads
    // env at call time, so same function works with new key.
    const b = computeHash("0", "OFFER|test");

    assert.notEqual(a, b, "different keys must give different codes");
    process.env.HMAC_SECRET = "test-key-for-hmac-swap";
  });

  it("fails when HMAC_SECRET is missing, never uses an empty key", async () => {
    const old = process.env.HMAC_SECRET;
    delete process.env.HMAC_SECRET;
    const { computeHash } = await import("../src/lib/hashChain.js");
    assert.throws(() => computeHash("0", "OFFER|test"), /HMAC_SECRET/);
    process.env.HMAC_SECRET = old;
  });
});
