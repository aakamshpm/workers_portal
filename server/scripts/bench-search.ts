import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import pg from "pg";
import { haversineKm, nearbyUsersSql } from "../src/lib/nearby";
import { benchTargetAllowed, percentile, seeded, syntheticWorkers, type Town } from "./bench-lib";

/**
 * ===========================================================================
 * Nearby search benchmark. ADR-0016, docs/phase2/research-brief.md (A3).
 * ===========================================================================
 *
 *   npm --prefix server run bench:search
 *   npm --prefix server run bench:search -- --sizes 1000,10000 --queries 10
 *
 * Makes its own database (BENCH_DATABASE_URL, default wage_bench on localhost),
 * applies the real migrations, fills it with synthetic users near the Kerala
 * district towns, and times one search three ways at each size:
 *
 *   haversine_app   read every opted-in row into Node, Haversine each, sort,
 *                   keep the nearest 50. The simplest possible program.
 *   postgis_scan    the real route query, with index scans switched off for
 *                   that query, so PostgreSQL computes the distance to every
 *                   row. This is how the app ran before ADR-0016.
 *   postgis_gist    the real route query with the GiST index. How it runs now.
 *
 * All three answer the same question as GET /api/discovery/nearby-workers:
 * opted-in workers within 25 km, nearest first, at most 50. The two PostGIS
 * methods must return the same rows; the run stops if they do not.
 *
 * Time is measured in this process around each query (wall clock, database on
 * the same machine), because that is what a request waits for. Each method
 * gets the same query centres. A few warm-up queries run first and are not
 * counted, so every method is measured with the data already in memory.
 *
 * Writes to docs/research/results/:
 *   search_bench.csv   users, method, p50_ms, p95_ms, mean_ms, avg_results
 *   search_index.csv   users, index_bytes, table_bytes, build_ms
 *   search_env.txt     machine, versions, settings of this run
 *
 * The database is dropped at the end unless --keep is given.
 */

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(here, "../../docs/research/results");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const SIZES = (arg("sizes") ?? "1000,10000,100000,1000000").split(",").map(Number);
const QUERIES = Number(arg("queries") ?? 30);
const WARMUP = 3;
const RADIUS_KM = 25;
const LIMIT = 50;
const SEED = 20260930;
const KEEP = process.argv.includes("--keep");

const BENCH_URL = process.env.BENCH_DATABASE_URL ?? "postgresql://wage:wage@localhost:5432/wage_bench";

const METHODS = ["haversine_app", "postgis_scan", "postgis_gist"] as const;
type Method = (typeof METHODS)[number];

function log(msg: string) {
  process.stdout.write(`${new Date().toISOString().slice(11, 19)}  ${msg}\n`);
}

async function recreateDatabase() {
  const url = new URL(BENCH_URL);
  const name = url.pathname.slice(1);
  url.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  // The name was checked by benchTargetAllowed (letters, digits, _ only).
  await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: resolve(here, ".."),
    env: { ...process.env, DATABASE_URL: BENCH_URL },
    stdio: "ignore",
  });
}

async function dropDatabase() {
  const url = new URL(BENCH_URL);
  const name = url.pathname.slice(1);
  url.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
  await admin.end();
}

/** Insert users [from, to) in batches, with arrays so one statement carries thousands of rows. */
async function insertUsers(db: pg.Client, towns: Town[], from: number, to: number) {
  const BATCH = 10_000;
  for (let start = from; start < to; start += BATCH) {
    const rows = syntheticWorkers(towns, start, Math.min(to, start + BATCH), SEED);
    await db.query(
      `INSERT INTO "User" (id, phone, name, role, looking, latitude, longitude, "locationName")
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::bool[], $6::float8[], $7::float8[], $8::text[])`,
      [
        rows.map((r) => `bench${r.phone}`),
        rows.map((r) => r.phone),
        rows.map((r) => r.name),
        rows.map((r) => r.role),
        rows.map((r) => r.looking),
        rows.map((r) => r.latitude),
        rows.map((r) => r.longitude),
        rows.map((r) => r.locationName),
      ],
    );
  }
}

/** The index definition, read from the database so it is exactly the migration's. */
async function indexDefinition(db: pg.Client): Promise<string> {
  const r = await db.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'User_location_gist'`);
  if (!r.rows[0]) throw new Error("User_location_gist is missing. Did the migration run?");
  return r.rows[0].indexdef as string;
}

type Row = { id: string; distanceKm: number };

async function runQuery(db: pg.Client, method: Method, lat: number, lng: number): Promise<Row[]> {
  const q = nearbyUsersSql({ role: "WORKER", lat, lng, radiusM: RADIUS_KM * 1000, limit: LIMIT });

  if (method === "postgis_gist") {
    return (await db.query(q.text, q.values)).rows as Row[];
  }

  if (method === "postgis_scan") {
    // Same query; the planner may not use any index for it, so it reads every row.
    await db.query("BEGIN");
    await db.query("SET LOCAL enable_indexscan = off");
    await db.query("SET LOCAL enable_bitmapscan = off");
    const rows = (await db.query(q.text, q.values)).rows as Row[];
    await db.query("COMMIT");
    return rows;
  }

  // haversine_app: every candidate row travels to Node, and the work happens here.
  const all = await db.query(
    `SELECT id, latitude, longitude FROM "User" WHERE role = 'WORKER' AND looking = true AND latitude IS NOT NULL`,
  );
  const hits: Row[] = [];
  for (const r of all.rows as { id: string; latitude: number; longitude: number }[]) {
    const d = haversineKm(lat, lng, r.latitude, r.longitude);
    if (d <= RADIUS_KM) hits.push({ id: r.id, distanceKm: d });
  }
  hits.sort((a, b) => a.distanceKm - b.distanceKm);
  return hits.slice(0, LIMIT);
}

async function main() {
  const allowed = benchTargetAllowed(BENCH_URL, process.env.NODE_ENV);
  if (!allowed.ok) {
    console.error(`Benchmark refused: ${allowed.reason}`);
    process.exit(1);
  }
  if (SIZES.some((n) => !Number.isInteger(n) || n < 1) || [...SIZES].sort((a, b) => a - b).join() !== SIZES.join()) {
    console.error("--sizes must be whole numbers in increasing order, for example 1000,10000");
    process.exit(1);
  }

  log(`database ${new URL(BENCH_URL).pathname.slice(1)}: recreating and applying migrations`);
  await recreateDatabase();

  const db = new pg.Client({ connectionString: BENCH_URL });
  await db.connect();

  const towns = (await db.query(`SELECT name, latitude, longitude FROM "Town" ORDER BY name`)).rows as Town[];
  const indexDef = await indexDefinition(db);

  // The same query centres for every method and size: a town, moved up to ~5 km.
  const next = seeded(SEED);
  const centres = Array.from({ length: WARMUP + QUERIES }, () => {
    const t = towns[Math.floor(next() * towns.length)]!;
    return { lat: t.latitude + (next() - 0.5) * 0.1, lng: t.longitude + (next() - 0.5) * 0.1 };
  });

  const bench: string[] = ["users,method,p50_ms,p95_ms,mean_ms,avg_results"];
  const index: string[] = ["users,index_bytes,table_bytes,build_ms"];
  let have = 0;

  for (const size of SIZES) {
    log(`${size.toLocaleString("en-IN")} users: inserting`);
    // Build the index after loading, the usual way for a bulk load, and time it.
    await db.query(`DROP INDEX IF EXISTS "User_location_gist"`);
    await insertUsers(db, towns, have, size);
    have = size;

    const t0 = performance.now();
    await db.query(indexDef);
    const buildMs = performance.now() - t0;
    await db.query(`VACUUM ANALYZE "User"`);

    const sizes = await db.query(
      `SELECT pg_relation_size('"User_location_gist"') AS idx, pg_relation_size('"User"') AS tbl`,
    );
    index.push(`${size},${sizes.rows[0].idx},${sizes.rows[0].tbl},${buildMs.toFixed(1)}`);

    const byMethod = new Map<Method, Row[][]>();
    for (const method of METHODS) {
      const times: number[] = [];
      const results: Row[][] = [];
      for (const [i, c] of centres.entries()) {
        const s = performance.now();
        const rows = await runQuery(db, method, c.lat, c.lng);
        const ms = performance.now() - s;
        if (i >= WARMUP) {
          times.push(ms);
          results.push(rows);
        }
      }
      byMethod.set(method, results);
      const mean = times.reduce((a, b) => a + b, 0) / times.length;
      const avg = results.reduce((a, r) => a + r.length, 0) / results.length;
      bench.push(
        `${size},${method},${percentile(times, 50).toFixed(3)},${percentile(times, 95).toFixed(3)},${mean.toFixed(3)},${avg.toFixed(1)}`,
      );
      log(
        `${size.toLocaleString("en-IN").padStart(10)}  ${method.padEnd(14)} p50 ${percentile(times, 50).toFixed(2).padStart(9)} ms   p95 ${percentile(times, 95).toFixed(2).padStart(9)} ms`,
      );
    }

    // Both PostGIS methods run the same query, so they must agree row for row.
    const scan = byMethod.get("postgis_scan")!;
    const gist = byMethod.get("postgis_gist")!;
    for (let q = 0; q < scan.length; q++) {
      const a = scan[q]!.map((r) => r.id).join();
      const b = gist[q]!.map((r) => r.id).join();
      if (a !== b) throw new Error(`At ${size} users, query ${q}: the index returned different rows from the full scan`);
    }
  }

  const version = (await db.query("SELECT version() AS v, postgis_lib_version() AS p")).rows[0];
  const settings = (await db.query(`SELECT name, setting, unit FROM pg_settings WHERE name IN ('shared_buffers','work_mem')`)).rows;
  await db.end();

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, "search_bench.csv"), bench.join("\n") + "\n");
  writeFileSync(resolve(OUT_DIR, "search_index.csv"), index.join("\n") + "\n");
  writeFileSync(
    resolve(OUT_DIR, "search_env.txt"),
    [
      `date: ${new Date().toISOString()}`,
      `cpu: ${cpus()[0]?.model} (${cpus().length} threads)`,
      `memory: ${(totalmem() / 2 ** 30).toFixed(1)} GiB`,
      `node: ${process.version}`,
      `postgres: ${version.v}`,
      `postgis: ${version.p}`,
      ...settings.map((s: { name: string; setting: string; unit: string | null }) => `${s.name}: ${s.setting}${s.unit ?? ""}`),
      `sizes: ${SIZES.join(", ")}`,
      `queries per method and size: ${QUERIES} (after ${WARMUP} warm-up)`,
      `radius: ${RADIUS_KM} km, limit ${LIMIT}, role WORKER, opted in only`,
      `data: users near the ${towns.length} district towns, up to ~15 km away; 1 in 10 contractors; 4 in 5 opted in; seed ${SEED}`,
      `index: ${indexDef}`,
      `timing: wall clock in the benchmark process around each query; database in Docker on the same machine`,
    ].join("\n") + "\n",
  );
  log(`wrote ${OUT_DIR}/search_bench.csv, search_index.csv, search_env.txt`);

  if (!KEEP) {
    await dropDatabase();
    log("dropped the benchmark database");
  }
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
