# ADR-0024: A handover code has five tries and comes from the operating system's random source

## Status

Accepted.

## Context

A cash payment is proved by a 4-digit code. The server sends it to the worker's phone, the worker reads it to the contractor after he has the money, and the contractor types it in (`POST /api/payments/confirm-code`). A right code records the payment and the worker's confirmation in one step, so the code is the worker's agreement.

Three things weakened that proof:

- **No limit on wrong codes.** A wrong code answered `404` and was not counted. There are 9,000 possible codes and a code lives for 15 minutes, so a contractor with a script could try every code and record a cash payment the worker never agreed to.
- **`Math.random`.** The code came from `Math.random`, which is not meant for secrets. The phone codes already use `randomInt` from `node:crypto` (ADR-0014).
- **One code, two payments.** The code was checked, and then marked used inside the transaction without checking that it was still unused. Two requests with the right code at the same moment could both pass the check and record the payment twice.

## Decision

- **Five wrong tries spend the code**, the same number as the phone codes and the PIN. A new column `HandoverCode.attempts` counts them. The count is raised with one atomic update, so two wrong codes sent together both count.
- **The route looks up the live code of that contract and contractor, and then compares the code**, instead of searching for a row with the typed code. This is what makes a wrong try countable.
- **A right code is claimed with one conditional update** (`usedAt` still empty and fewer than five tries) inside the payment's transaction. If the claim fails, the transaction is rolled back and nothing is recorded.
- **The code comes from `randomInt(1000, 10000)`** in `node:crypto`.
- **A spent or expired code is not shown as waiting** by `GET /api/payments/pending-code`, and the contractor's page goes back to the first step, so he can send a new code.

## Consequences

- A contractor who mistypes five times must send a new code, which sends the worker another SMS.
- There is still no limit on how many codes a contractor may request. Each request sends an SMS to the worker, so guessing through many codes is visible to him and limited by the SMS budget, but it is not prevented. A limit per contract is a separate decision.
- The code is still stored as plain digits for its 15 minutes, unlike the phone codes, which are stored as a bcrypt hash.
- Contract: `docs/contracts/payments.md`.
