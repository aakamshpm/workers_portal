import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import pg from "pg";
import { benchTargetAllowed, percentile } from "./bench-lib";

/**
 * ===========================================================================
 * Ledger verification benchmark. ADR-0017, docs/phase2/research-brief.md (B5).
 * ===========================================================================
 *
 *   npm --prefix server run bench:verify
 *   npm --prefix server run bench:verify -- --sizes 1000,10000 --runs 3 --per-row-max 10000
 *
 * Makes its own database (BENCH_DATABASE_URL, default wage_bench on localhost),
 * applies the real migrations, and fills it with one contract and n sealed
 * payments. Then it times, at each size:
 *
 *   chain_per_row       the check as the app ran it before 29 Sep 2026: every
 *                       row rebuilt with rebuildPayload(), one query per row,
 *                       all at once. rebuildPayload() now reads with findMany
 *                       where it used findUnique, which Prisma had batched, so
 *                       this is slower at 1,000 rows than the old app (90 ms
 *                       then). Only up to --per-row-max rows (default
 *                       20000), because its time grows faster than the row count.
 *   chain_batched       verifyLedger() as the app runs it now: the live rows
 *                       read with one query per table (rebuildPayloads), then
 *                       rebuilt in memory.
 *   merkle_root         read the leaves (ledgerLeaves) and compute the root.
 *   merkle_proof_build  read the leaves and build one inclusion proof (server).
 *   merkle_proof_check  check that proof against the root (worker's phone).
 *
 * The two chain methods must give the same answer: valid on the untouched data,
 * and the same failure after one payment amount is changed. The run stops if
 * they differ, or if any proof fails to verify.
 *
 * Writes docs/research/results/verify_bench.csv
 *   rows, method, total_ms (median of the runs), proof_bytes (0 = no proof), runs
 * and verify_env.txt. The database is dropped at the end unless --keep is given.
 */

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(here, "../../docs/research/results");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const SIZES = (arg("sizes") ?? "1000,5000,10000,20000,100000").split(",").map(Number);
// The old per-row check starts one query per row at once, and its time grows faster
// than the row count (1k: ~0.1 s, 10k: ~2.5 s). At 100k one run did not finish
// in 18 minutes, so it is only measured up to this size.
const PER_ROW_MAX = Number(arg("per-row-max") ?? 20000);
const RUNS = Number(arg("runs") ?? 5);
const KEEP = process.argv.includes("--keep");
const BENCH_URL = process.env.BENCH_DATABASE_URL ?? "postgresql://wage:wage@localhost:5432/wage_bench";

// Before src/lib/prisma.ts loads: point it at the benchmark database, and use a
// benchmark key so the real HMAC_SECRET is never needed here.
process.env.DATABASE_URL = BENCH_URL;
process.env.HMAC_SECRET = "bench-only-hmac-key";

function log(msg: string) {
  process.stdout.write(`${new Date().toISOString().slice(11, 19)}  ${msg}\n`);
}

function adminUrl() {
  const url = new URL(BENCH_URL);
  const name = url.pathname.slice(1);
  url.pathname = "/postgres";
  return { name, admin: url.toString() };
}

async function recreateDatabase() {
  const { name, admin } = adminUrl();
  const c = new pg.Client({ connectionString: admin });
  await c.connect();
  // The name was checked by benchTargetAllowed (letters, digits, _ only).
  await c.query(`DROP DATABASE IF EXISTS "${name}"`);
  await c.query(`CREATE DATABASE "${name}"`);
  await c.end();
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: resolve(here, ".."),
    env: { ...process.env, DATABASE_URL: BENCH_URL },
    stdio: "ignore",
  });
}

async function dropDatabase() {
  const { name, admin } = adminUrl();
  const c = new pg.Client({ connectionString: admin });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS "${name}"`);
  await c.end();
}

async function main() {
  const allowed = benchTargetAllowed(BENCH_URL, process.env.NODE_ENV);
  if (!allowed.ok) {
    console.error(`Benchmark refused: ${allowed.reason}`);
    process.exit(1);
  }
  if (SIZES.some((n) => !Number.isInteger(n) || n < 2) || [...SIZES].sort((a, b) => a - b).join() !== SIZES.join()) {
    console.error("--sizes must be whole numbers >= 2 in increasing order, for example 1000,10000");
    process.exit(1);
  }

  log(`database ${adminUrl().name}: recreating and applying migrations`);
  await recreateDatabase();

  const { prisma } = await import("../src/lib/prisma");
  const { verifyLedger, ledgerLeaves, rebuildPayload } = await import("../src/lib/ledger");
  const { GENESIS_HASH, canonicalPayload, computeHash, verifyChain } = await import("../src/lib/hashChain");
  const { merkleRoot, inclusionProof, verifyInclusion, leafHash } = await import("../src/lib/merkle");

  const db = new pg.Client({ connectionString: BENCH_URL });
  await db.connect();

  // One worker, one contractor, one offer. Every ledger row is a payment on it.
  await db.query(
    `INSERT INTO "User" (id, phone, name, role) VALUES ('w', '7000000001', 'Bench Worker', 'WORKER'), ('c', '7000000002', 'Bench Contractor', 'CONTRACTOR')`,
  );
  await db.query(
    `INSERT INTO "WorkOffer" (id, "workerId", "contractorId", "dailyRate", "workType", "siteName", "startDate", "expectedDays")
     VALUES ('o', 'w', 'c', 800, 'Painting', 'Bench site', '2026-07-01', 30)`,
  );

  const paymentText = (i: number, amount: number) =>
    canonicalPayload({
      type: "PAYMENT",
      offerId: "o",
      workerId: "w",
      amount,
      paidOn: new Date(Date.UTC(2026, 6, 1 + (i % 28))).toISOString(),
      method: "CASH",
      note: "",
    });

  /** Rows [from, to), continuing the chain from `previousHash`. Returns the new tail. */
  async function insertRows(from: number, to: number, previousHash: string): Promise<string> {
    const BATCH = 5_000;
    let prev = previousHash;
    for (let start = from; start < to; start += BATCH) {
      const end = Math.min(to, start + BATCH);
      const idx = Array.from({ length: end - start }, (_, j) => start + j);
      const hashes: string[] = [];
      const prevs: string[] = [];
      for (const i of idx) {
        prevs.push(prev);
        prev = computeHash(prev, paymentText(i, 1000 + i));
        hashes.push(prev);
      }
      await db.query(
        `INSERT INTO "Payment" (id, "offerId", amount, "paidOn", method)
         SELECT * FROM unnest($1::text[], $2::text[], $3::float8[], $4::timestamptz[], $5::text[])`,
        [
          idx.map((i) => `p${i}`),
          idx.map(() => "o"),
          idx.map((i) => 1000 + i),
          idx.map((i) => new Date(Date.UTC(2026, 6, 1 + (i % 28))).toISOString()),
          idx.map(() => "CASH"),
        ],
      );
      await db.query(
        `INSERT INTO "LedgerEntry" (id, "chainIndex", "recordType", "recordId", payload, "workerId", summary, "previousHash", "currentHash")
         SELECT * FROM unnest($1::text[], $2::int[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[])`,
        [
          idx.map((i) => `e${i}`),
          idx,
          idx.map(() => "PAYMENT"),
          idx.map((i) => `p${i}`),
          idx.map((i) => paymentText(i, 1000 + i)),
          idx.map(() => "w"),
          idx.map((i) => `Payment ${i}`),
          prevs,
          hashes,
        ],
      );
    }
    return prev;
  }

  /** chain_per_row: the old verifyLedger(), kept here only to measure it. */
  async function verifyPerRow() {
    const links = await prisma.ledgerEntry.findMany({
      orderBy: { chainIndex: "asc" },
      select: { id: true, chainIndex: true, recordType: true, recordId: true, summary: true, payload: true, previousHash: true, currentHash: true },
    });
    const withCurrent = await Promise.all(
      links.map(async (l) => ({ ...l, currentPayload: await rebuildPayload(l.recordType, l.recordId) })),
    );
    return verifyChain(withCurrent);
  }

  /** chain_batched: the app's verifyLedger(). */
  const verifyBatched = () => verifyLedger();

  const summaryOf = (r: { valid: boolean; failures: { chainIndex: number; problem: string }[] }) =>
    `${r.valid}:${r.failures.map((f) => `${f.chainIndex}:${f.problem}`).join(",")}`;

  async function time<T>(fn: () => Promise<T> | T, runs: number): Promise<{ ms: number; last: T }> {
    await fn(); // warm-up, not counted
    const times: number[] = [];
    let last!: T;
    for (let r = 0; r < runs; r++) {
      const t0 = performance.now();
      last = await fn();
      times.push(performance.now() - t0);
    }
    return { ms: percentile(times, 50), last };
  }

  const csv: string[] = ["rows,method,total_ms,proof_bytes,runs"];
  let have = 0;
  let tail = GENESIS_HASH;

  for (const size of SIZES) {
    log(`${size.toLocaleString("en-IN")} rows: inserting`);
    tail = await insertRows(have, size, tail);
    have = size;
    await db.query(`ANALYZE`);

    const batched = await time(() => verifyBatched(), RUNS);
    if (!batched.last.valid) throw new Error(`untouched ledger: batched says ${summaryOf(batched.last)}`);
    const perRowRuns = size >= 10_000 ? Math.min(RUNS, 3) : RUNS;
    const perRow = size <= PER_ROW_MAX ? await time(() => verifyPerRow(), perRowRuns) : null;
    if (perRow && summaryOf(perRow.last) !== summaryOf(batched.last)) {
      throw new Error(`untouched ledger: per_row ${summaryOf(perRow.last)} vs batched ${summaryOf(batched.last)}`);
    }

    const root = await time(async () => merkleRoot(await ledgerLeaves()), RUNS);

    // One proof for a row in the middle, as a worker checking his own payment.
    const target = Math.floor(size / 2) + 1;
    const build = await time(async () => inclusionProof(await ledgerLeaves(), target), RUNS);
    const proof = build.last;
    const leaves = await ledgerLeaves();
    const lh = leafHash(leaves[target]!);
    const check = await time(() => verifyInclusion(target, size, lh, proof, root.last), Math.max(RUNS, 1000));
    if (!check.last) throw new Error(`inclusion proof for row ${target} of ${size} did not verify`);

    const proofBytes = proof.length * 32;
    if (perRow) csv.push(`${size},chain_per_row,${perRow.ms.toFixed(3)},0,${perRowRuns}`);
    csv.push(
      `${size},chain_batched,${batched.ms.toFixed(3)},0,${RUNS}`,
      `${size},merkle_root,${root.ms.toFixed(3)},0,${RUNS}`,
      `${size},merkle_proof_build,${build.ms.toFixed(3)},${proofBytes},${RUNS}`,
      `${size},merkle_proof_check,${check.ms.toFixed(4)},${proofBytes},${Math.max(RUNS, 1000)}`,
    );
    for (const line of csv.slice(perRow ? -5 : -4)) log(`  ${line}`);
  }

  // Both chain checks must find the same edit. Change one amount, check, restore.
  // At the largest size the per-row check is too slow, so shrink to PER_ROW_MAX
  // first: delete the rows above it (the benchmark database is thrown away).
  if (have > PER_ROW_MAX) {
    await db.query(`DELETE FROM "LedgerEntry" WHERE "chainIndex" >= $1`, [PER_ROW_MAX]);
    await db.query(`DELETE FROM "Payment" WHERE id <> ALL(SELECT "recordId" FROM "LedgerEntry")`);
    have = PER_ROW_MAX;
  }
  const edited = `p${Math.floor(have / 3)}`;
  await db.query(`UPDATE "Payment" SET amount = 1 WHERE id = $1`, [edited]);
  const [a, b] = [await verifyPerRow(), await verifyBatched()];
  await db.query(`UPDATE "Payment" SET amount = 1000 + $2 WHERE id = $1`, [edited, Math.floor(have / 3)]);
  if (a.valid || summaryOf(a) !== summaryOf(b)) {
    throw new Error(`edited ledger: per_row ${summaryOf(a)} vs batched ${summaryOf(b)}`);
  }
  log(`edit check: both chain methods report ${summaryOf(a)}`);

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, "verify_bench.csv"), csv.join("\n") + "\n");

  const version = (await db.query(`SELECT version() AS v`)).rows[0];
  writeFileSync(
    resolve(OUT_DIR, "verify_env.txt"),
    [
      `date: ${new Date().toISOString()}`,
      `cpu: ${cpus()[0]?.model} (${cpus().length} threads)`,
      `memory: ${(totalmem() / 2 ** 30).toFixed(1)} GiB`,
      `node: ${process.version}`,
      `postgres: ${version.v}`,
      `sizes: ${SIZES.join(", ")}`,
      `runs: ${RUNS} after 1 warm-up (chain_per_row: at most 3 from 10000 rows; merkle_proof_check: ${Math.max(RUNS, 1000)})`,
      `chain_per_row: the pre-29-Sep check (one rebuildPayload per row), measured only up to ${PER_ROW_MAX} rows; at 100000 one run of the original did not finish in 18 minutes`,
      `chain_batched: verifyLedger() as the app runs it now (one query per table)`,
      `data: one contract, n PAYMENT rows, each sealed with HMAC-SHA-256 (benchmark key)`,
      `total_ms: median wall-clock time in the benchmark process; database in Docker on the same machine`,
      `proof_bytes: number of hashes in the inclusion proof x 32`,
    ].join("\n") + "\n",
  );
  log(`wrote ${OUT_DIR}/verify_bench.csv, verify_env.txt`);

  await db.end();
  await prisma.$disconnect();
  if (!KEEP) {
    await dropDatabase();
    log("dropped the benchmark database");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
