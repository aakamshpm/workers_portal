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

## Done for a slice

- Tests green
- `npx tsc` clean on server and client
- Docs in the owning folder updated
- If the slice is a phase, a human uses the running app before the next phase starts
