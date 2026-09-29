import "./setup";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { verifyChain } from "../src/lib/hashChain";
import { ATTACKS, METHODS, applyAttack, buildLedger, checkChain, hmacHash, simulate } from "../scripts/tamper-lib";

/**
 * The tamper simulation (ADR-0017, research brief B4). What these tests guarantee:
 *
 *   1. The simulation's chain checker reports exactly what the app's
 *      verifyChain() reports, for every attack. So the tamper.csv results are
 *      the results of the real check, not of a copy that might differ.
 *   2. The detection table in the research write-up is the one the code produces.
 *      If a change to hashing or verification changes any cell, this test fails.
 *   3. With nothing changed, no method reports a problem (no false alarm).
 */

describe("tamper simulation", () => {
  it("the chain checker agrees with the app's verifyChain for every attack", () => {
    for (const attack of ATTACKS) {
      const links = applyAttack(attack, buildLedger(40, hmacHash), hmacHash);
      const app = verifyChain(links).failures.map((f) => `${f.chainIndex}:${f.problem}`);
      const sim = checkChain(links, hmacHash).map((f) => `${f.chainIndex}:${f.problem}`);
      assert.deepEqual(sim, app, attack);
    }
  });

  it("gives the detection table of the research write-up", () => {
    // [detected, row found] for chain_sha256, chain_hmac, chain_hmac_merkle_root
    const want: Record<string, [boolean, boolean][]> = {
      none: [[false, false], [false, false], [false, false]],
      edit_record: [[true, true], [true, true], [true, true]],
      delete_row: [[true, true], [true, true], [true, true]],
      delete_last_row: [[false, false], [false, false], [true, false]],
      insert_row: [[true, true], [true, true], [true, true]],
      reorder_rows: [[true, true], [true, true], [true, true]],
      rewrite_without_key: [[false, false], [true, true], [true, true]],
      rewrite_with_key: [[false, false], [false, false], [true, false]],
    };
    assert.deepEqual(Object.keys(want), [...ATTACKS]);

    const results = simulate(100);
    for (const attack of ATTACKS) {
      METHODS.forEach((method, i) => {
        const r = results.find((x) => x.attack === attack && x.method === method)!;
        assert.deepEqual([r.detected, r.rowFound], want[attack]![i], `${attack} / ${method}`);
      });
    }
  });
});
