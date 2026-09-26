# Teammate boundaries

Four people. One person understands the ledger. The others use OpenCode with the `ui` agent.

## May edit

New pages and components inside the three apps (ADR-0012): `client/src/worker/`, `client/src/contractor/`, `client/src/officer/`, and shared components in `client/src/shared/`. That includes `client/src/worker/FindWorkPage.tsx`, `client/src/contractor/FindWorkersPage.tsx`, PWA files, `client/src/shared/components/MapView.tsx`, and copy on existing screens that does not change money logic.

A page belongs to one app folder. Put it in `shared/` only when more than one app uses it. Officer pages never get a manifest, an install prompt or a hiring map.

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
