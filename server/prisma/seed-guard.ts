/**
 * Whether the development seed may run. ADR-0014.
 *
 * The seed deletes every user before writing sample data. On a real database
 * that would destroy every worker's ledger, which cannot be rebuilt, so the
 * seed runs only against a database on this machine, and never in production.
 *
 * The address is checked, not the database name, because a real database
 * could be given the same name as the development one.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function seedAllowed(
  databaseUrl: string | undefined,
  nodeEnv: string | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (nodeEnv === "production") {
    return { ok: false, reason: "NODE_ENV is production. The seed deletes every user." };
  }
  if (!databaseUrl) {
    return { ok: false, reason: "DATABASE_URL is not set." };
  }

  let host: string;
  try {
    host = new URL(databaseUrl).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return { ok: false, reason: "DATABASE_URL is not a valid address." };
  }

  if (!LOCAL_HOSTS.has(host)) {
    return {
      ok: false,
      reason: `The database is on ${host}, not localhost. The seed deletes every user, so it runs only on this machine.`,
    };
  }
  return { ok: true };
}
