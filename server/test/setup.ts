import "dotenv/config";

/**
 * ===========================================================================
 * Test database guard.
 * ===========================================================================
 *
 * Route and provider tests create users, offers and ledger rows. Run against
 * the development database, they append real chain entries whose underlying
 * rows are deleted in cleanup, and `verifyLedger()` then reports
 * RECORD_MISSING for ever - the ledger is append-only, so there is no way to
 * remove those entries afterwards.
 *
 * Importing this module first points `DATABASE_URL` at `TEST_DATABASE_URL`
 * before any file loads `src/lib/prisma.ts`, because that module reads the
 * variable once at import time.
 *
 * It also sets `HMAC_SECRET` when absent, since ADR-0004 forbids an empty key.
 */

const testUrl = process.env.TEST_DATABASE_URL;

if (testUrl) {
  process.env.DATABASE_URL = testUrl;
} else if (!process.env.DATABASE_URL?.includes("wage_test")) {
  throw new Error(
    "Tests write rows and must not touch the development ledger. " +
      "Set TEST_DATABASE_URL in server/.env (see .env.example).",
  );
}

if (!process.env.HMAC_SECRET) {
  process.env.HMAC_SECRET = "test-key-for-hmac-swap";
}

// ADR-0013: the server refuses to run without a JWT secret.
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "test-jwt-secret";
}
