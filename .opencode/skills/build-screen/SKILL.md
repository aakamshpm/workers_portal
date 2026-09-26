---
name: build-screen
description: Build a new frontend page against an existing API contract. Use when adding Find Work, Find Workers, or any new screen. Not for restyling alone.
---

# build-screen

1. Confirm the contract exists under `docs/contracts/` and the route is listed there. If the route is not implemented, that is backend work (`discovery-api`), not this skill.
2. Write page tests first: loading, empty list, error, happy path with JSON shaped like the contract. Confirm they fail.
3. Implement a thin page that calls `client/src/shared/api.ts`. Add the API function if missing, typed to the contract.
4. Put the page in the app that owns it: `client/src/worker/`, `client/src/contractor/` or `client/src/officer/` (ADR-0012). Wire its route in that app's `App.tsx`. Each app already turns away other roles.
5. The officer app never gets a hiring map, a manifest or an install prompt.
6. Update `docs/project/milestones.md` if this closes a listed item.

Do not edit `hashChain.ts`, `ledger.ts`, `offers.ts`, `auth.ts`, `payments.ts`, or `schema.prisma`.
