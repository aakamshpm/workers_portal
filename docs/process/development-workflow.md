# Development workflow

Agents write tests and implementation. Humans look at the running product at the end of a phase.

## Order for every behaviour

1. Read the contract or ADR that describes the behaviour. If none exists, stop and write one (`write-adr` or a file under `docs/contracts/`).
2. Write the failing tests.
3. Run them. They must fail for the right reason (the code is missing or still old).
4. Write the minimum code that makes those tests pass.
5. Run the tests again. Stop when they pass.
6. Do not ask a human to approve the tests before step 4.

## Test levels

| Level | Where | Notes |
|---|---|---|
| Unit | `server/test/*.test.ts` | Hash, parseReply, Haversine. No live Textbee, no live Twilio |
| Route | same folder or `*.route.test.ts` | Fake `SmsProvider`. Real Postgres |
| Page | `client` tests when added | loading, empty, error, happy path |

Never call `api.textbee.dev` from a test. Never send a real SMS from CI.

## Tests use their own database

Every test file starts with `import "./setup";`, which points `DATABASE_URL` at
`TEST_DATABASE_URL` (`wage_test`) before Prisma loads.

This is not tidiness. Tests append ledger rows and then delete the offers those
rows sealed. The ledger is append-only, so on the development database
`verifyLedger()` reports `RECORD_MISSING` for ever and cannot be repaired
without a reseed. Create the test database once:

```bash
docker exec compose-db-1 psql -U wage -d postgres -c "CREATE DATABASE wage_test OWNER wage;"
DATABASE_URL="postgresql://wage:wage@localhost:5432/wage_test" npx --prefix server prisma migrate deploy
```

## Textbee free plan is a budget

50 messages a day, 300 a month, and every recipient counts as one. An offer plus
its receipt is two, and each work or payment row is two more, so one full demo
run costs roughly a dozen. Send real messages only to check the gateway. Tests
use the fake provider, and the inbound poll only runs when `TEXTBEE_API_KEY` is
set, so leave the key out of `server/.env` while working on anything else.

## Done for a slice

- Tests green
- `npx tsc` clean on server and client
- Docs in the owning folder updated
- If the slice is a phase, a human uses the running app before the next phase starts
