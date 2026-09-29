/**
 * Helpers for the search benchmark (scripts/bench-search.ts). ADR-0016.
 * Kept apart from the script so test/bench.test.ts can check them without a
 * database.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * The benchmark drops and recreates its database, so it runs only against a
 * local database whose name ends in "_bench". That name can never be the
 * development ledger (wage) or the test database (wage_test).
 */
export function benchTargetAllowed(
  databaseUrl: string | undefined,
  nodeEnv: string | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (nodeEnv === "production") return { ok: false, reason: "NODE_ENV is production." };
  if (!databaseUrl) return { ok: false, reason: "BENCH_DATABASE_URL is not set." };
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return { ok: false, reason: "BENCH_DATABASE_URL is not a valid address." };
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!LOCAL_HOSTS.has(host)) return { ok: false, reason: `The database is on ${host}, not this machine.` };
  const name = url.pathname.replace(/^\//, "");
  if (!/^[a-z0-9_]+_bench$/.test(name)) {
    return { ok: false, reason: `The database is "${name}". The benchmark drops its database, so the name must end in _bench.` };
  }
  return { ok: true };
}

/** The p-th percentile by the nearest-rank method: the smallest value with at least p% of values at or below it. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new Error("percentile of an empty list");
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1]!;
}

/** A repeatable pseudo-random sequence (Mulberry32), so every run makes the same data. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Town {
  name: string;
  latitude: number;
  longitude: number;
}

export interface SyntheticUser {
  phone: string;
  name: string;
  role: "WORKER" | "CONTRACTOR";
  looking: boolean;
  latitude: number;
  longitude: number;
  locationName: string;
}

/**
 * Users `from` to `to - 1`, each placed near one of the towns.
 *
 * Real users choose a town (ADR-0011), so many share one point. Here each is
 * moved up to about 15 km from its town, so the data also covers the space
 * between towns, which is the harder case for the index. Every tenth user is a
 * contractor. Four in five have opted in, because the index holds only those.
 *
 * The same seed and range always give the same users, so a run can be
 * repeated and made in batches.
 */
export function syntheticWorkers(towns: readonly Town[], from: number, to: number, seed: number): SyntheticUser[] {
  const out: SyntheticUser[] = [];
  for (let i = from; i < to; i++) {
    // One sequence per user, so batch boundaries do not change the data.
    const next = seeded(seed * 1_000_003 + i);
    const town = towns[Math.floor(next() * towns.length)]!;
    out.push({
      phone: `7${String(i).padStart(9, "0")}`,
      name: `Bench ${i}`,
      role: i % 10 === 0 ? "CONTRACTOR" : "WORKER",
      looking: i % 5 !== 0,
      latitude: town.latitude + (next() - 0.5) * 0.3,
      longitude: town.longitude + (next() - 0.5) * 0.3,
      locationName: town.name,
    });
  }
  return out;
}
