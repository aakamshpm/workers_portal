# ADR-0020: The phone-code route says when a number is or is not registered

## Status

Accepted. Replaces the "same answer for every number" rule of ADR-0014 for `POST /api/auth/code`. The rest of ADR-0014 stands.

## Context

ADR-0014 made `POST /api/auth/code` answer `{ sent: true }` for every number, and sent the SMS only when it made sense: a registration code only to a number with no account, a reset code only to a number with one. The aim was that nobody could use the route to learn which numbers are registered.

In use, this told the worker something false. A worker who already had an account and tapped "New worker" was told a code was on its way, waited for an SMS that never came, and had no way to learn why. If he typed any six digits, he went through his name, his state and his PIN before the last step said the number was registered. A reset for a number with no account ended with "That code is wrong or has expired", although no code had ever existed.

The same route had three other faults, found while reading it:

- The 1-a-minute and 5-a-day limits ran only when an SMS was sent, so the limits answered differently for registered and unregistered numbers. That difference revealed which numbers were registered anyway, while the comment said it did not.
- The code was stored, and counted towards the 5 a day, before the SMS was attempted. A failed send still used one of the worker's five codes, and he was shown "Something went wrong on the server".
- The call to Textbee had no time limit, so a gateway that did not answer kept the worker's screen on "Sending…" for minutes.

## Decision

- **The route says what happened.** A registration code for a number that already has an account is refused with `409` and the error code `PHONE_REGISTERED`. A reset code for a number with no account is refused with `404` and `PHONE_NOT_REGISTERED`. In both cases no SMS is sent and no code is stored. The sign-in page tells the worker which flow to use instead.
- **Every error from the sign-in routes carries a `code`** next to the English `error`, so the page shows the message in the reader's language instead of the server's English.
- **A failed SMS frees the code.** The code row is removed when the send fails, so it does not count towards the limits, and the route answers `502` with `SMS_FAILED`. The earlier code for the same phone is retired only after the new one has gone out.
- **Textbee is given 15 seconds**, after which the send counts as failed.
- **The fifth wrong PIN says the number is now locked**, with the minutes left, rather than answering like the four before it. A locked number is told how many minutes remain, not a fixed 15.

## Consequences

- **Anyone can now learn whether a phone number has an account**, one number at a time, from the sign-in page. The 5-a-day limit does not slow this down, because it counts codes per number and a lookup of a registered number sends no code. The login route still answers "Wrong phone number or PIN" for an unknown number, but that no longer hides anything, since this route answers the same question directly. The list would show who uses the app, not anything about their wages.
- This is accepted because a worker who is told the truth can act on it, and a worker who is told something false waits for an SMS that never comes. A limit on lookups per IP address would slow down someone checking many numbers. It is not built yet, and it should be added before the app is hosted (ADR-0008 hosting step).
- Contract: `docs/contracts/auth.md`.
