# Teammate boundaries

Four people. One person understands the ledger. The others use OpenCode with the `ui` agent.

## May edit

New pages, new components, `client/src/pages/FindWorkPage.tsx`, `client/src/pages/FindWorkersPage.tsx`, PWA files, `client/src/components/MapView.tsx`, copy on existing screens that does not change money logic.

## Must not edit

| Path | Why |
|---|---|
| `server/src/lib/hashChain.ts` | HMAC and canonical text |
| `server/src/lib/ledger.ts` | rebuildPayload — hashing the stored copy is the known bug |
| `server/src/routes/offers.ts` | money, accept, lock |
| `server/src/routes/auth.ts` | PIN, registration role |
| `server/src/routes/payments.ts` | handover code must not leak to the contractor |
| `server/prisma/schema.prisma` | schema changes are core only |

The `ui` agent has these paths set to `edit: deny`.

## Contract before pages

`docs/contracts/discovery.md` is written before Find Work or Find Workers. If the response shape is missing a field, change the contract first, then the route, then the page. Do not invent fields in the page.
