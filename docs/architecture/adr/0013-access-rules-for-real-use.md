# ADR-0013: Access rules for real use

## Status

Accepted.

## Context

The code was copied from a demo built for a tutor. Several shortcuts in it were acceptable for one evening in a classroom and are not acceptable with real workers' wages. Tested against the running API:

- `GET /api/auth/demo-accounts` returned every user's name, phone number and role to anyone, with no sign-in.
- `GET /api/ledger` returned every worker's records to any signed-in user, including other workers' rates and payments.
- `GET /api/offers/workers?phone=` with an empty search listed every worker and his phone number, including workers who never opted in to the directory (ADR-0006).
- Twelve wrong PINs in a row were all answered, so a script could try all 10,000 four-digit PINs.
- A missing `JWT_SECRET` fell back to a value written in the code, so anyone reading the code could sign sessions.

## Decision

- **Records.** A worker sees the records of his own contracts. A contractor sees the records of his own contracts, and not other contracts of the same worker. A labour officer sees every record. Only the officer may filter by `workerId`. Contract: `docs/contracts/ledger.md`.
- **The integrity check** still checks the whole chain, because one changed record breaks every record after it. It returns the details only of problems in records the caller can see, and a count of the rest.
- **The account list is removed.** No route lists users to someone who is not signed in.
- **Finding a worker** to send an offer needs his full 10-digit number. There is no partial search and no browsing. Opted-in workers are found through nearby search, which is the consented path.
- **Wrong PINs.** After 5 wrong PINs in a row for one phone number, that number cannot sign in for 15 minutes. A correct PIN resets the count. The count is stored on the user, so it survives a server restart.
- **`JWT_SECRET` is required.** A missing secret stops the server at startup, as `HMAC_SECRET` does (ADR-0004).

## Consequences

- The lock message tells someone that a number is registered. Registration already says so ("That number is already registered"), so this reveals nothing new.
- A locked-out worker must wait 15 minutes. There is still no way to reset a forgotten PIN; that needs its own decision.
- The development seed and its shared PIN stay, for local development only.
