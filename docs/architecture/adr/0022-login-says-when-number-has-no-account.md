# ADR-0022: The login route says when a number has no account

## Status

Accepted. Replaces the "same message for an unknown number" rule of ADR-0013 for `POST /api/auth/login`. ADR-0020 already accepted that the sign-in routes reveal whether a number has an account. This applies the same decision to the one route that still hid it.

## Context

`POST /api/auth/login` answered `401 WRONG_PIN`, "Wrong phone number or PIN", for a number with no account. The reason, written in the code and in ADR-0013, was that the answer must not reveal which numbers are registered.

ADR-0020 ended that reason: `POST /api/auth/code` tells anyone, one number at a time, whether a number has an account. The login message hides nothing any more, and it misleads. A worker who mistyped one digit of his number, or who never made an account, is told that the PIN may be wrong, so he tries other PINs and never checks the number. The sign-in page also asks for the PIN before it asks the server anything, so he learns this only after he has typed the PIN.

## Decision

- **An unknown number is refused with `404` and the error code `PHONE_NOT_REGISTERED`**, the code and status that the code route already uses for a reset with no account. A number that has an account and a wrong PIN is still `401 WRONG_PIN`.
- **The sign-in page shows the no-account message and goes back to the phone step.** The number stays in the box, so he can correct one digit, and the "New worker? Make an account" button is visible below. The PIN boxes are empty.
- **An account made by the labour office that has no PIN yet is not changed.** It still answers `WRONG_PIN` (ADR-0014). That answer is misleading in the same way, and it is left for a separate decision.

## Consequences

- Anyone can learn whether a number has an account from the login route as well as from the code route. ADR-0020 explains why this is accepted, and says a limit per IP address should be added before hosting. The login route needs the same limit then.
- A try on a number with no account is not counted towards the PIN lock, as before, because there is no account to lock.
- Contract: `docs/contracts/auth.md`.
