import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { simulate } from "./tamper-lib";

/**
 * Tamper simulation (ADR-0017). No database; the same answer every run.
 *
 *   npm --prefix server run tamper
 *
 * Writes docs/research/results/tamper.csv:
 *   attack, method, detected, row_found, target_row, first_reported
 */

// The simulation seals with HMAC; use a fixed key so the real one is never needed.
process.env.HMAC_SECRET = "tamper-simulation-key";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(here, "../../docs/research/results");
const ROWS = 100;

const lines = ["attack,method,detected,row_found,target_row,first_reported"];
for (const r of simulate(ROWS)) {
  lines.push([r.attack, r.method, r.detected, r.rowFound, r.targetRow, r.firstReported ?? ""].join(","));
}
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(resolve(OUT_DIR, "tamper.csv"), lines.join("\n") + "\n");
console.log(lines.join("\n"));
