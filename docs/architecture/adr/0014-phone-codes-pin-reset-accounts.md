# ADR-0014: Phone codes, PIN reset and account creation

## Status

Accepted.

## Context

After ADR-0013 three gaps remained before real use:

- Anyone could register someone else's phone number, and that person's phone then received every offer.
- A worker who forgot his PIN could never sign in again.
- Contractor and officer accounts could only come from the development seed.

Every SMS costs one message from the Textbee budget of 50 a day and 300 a month (ADR-0008).

## Decision

**One-time phone codes.**

- A 6-digit code, sent by SMS, proves that the person holds the phone. Six digits rather than four, because the code is guessed against a fresh value each time and must not be easy to find in a few tries.
- The code is stored only as a bcrypt hash, never in plain text, and it expires after 10 minutes. It can be used once.
- A code allows 5 wrong tries. After that it is spent, and a new code must be requested.
- One code at a time per phone number and purpose. A new request replaces the old code.
- At most 1 code a minute and 5 codes a day per phone number. This protects both the worker and the SMS budget.
- The server asks for a code with `POST /api/auth/code`. It answers the same way whether the number is registered or not, so the route cannot be used to find out who has an account.

**Registration.** A worker registers only with a code sent to the number he registers. Contractors and officers cannot register themselves.

**Forgot PIN.** Any user sets a new PIN with a code sent to his own number. Setting a new PIN clears the wrong-PIN lock.

**Accounts made by the labour office.**

- A labour officer creates contractor and officer accounts in the officer app, with name, phone and, for a contractor, the company.
- The officer never chooses the PIN. A new account has no PIN. Its owner sets one through "Forgot PIN", with a code sent to his own phone. So nobody, not even the officer, ever knows another person's PIN.
- An account with no PIN cannot sign in until its owner sets one.
- The first officer is created with a server command, `npm --prefix server run create-officer`, because there is no officer yet to create one in the app.

**The development seed** runs only against a database on `localhost` or `127.0.0.1`, and never when `NODE_ENV` is `production`. It deletes every user first, so running it on a real database would destroy the ledger. The check uses the database's address, not its name, because a real database could have the same name as the development one.

**The code SMS is not stored.** `SmsMessage` needs a user, and at registration there is none yet. Storing the message would also put the plain code in the database, which the hash is meant to prevent. So codes are sent through their own function, which writes no row.

## Consequences

- Each new worker and each PIN reset costs 1 SMS. Tests use the fake provider and send nothing.
- A worker whose phone is lost cannot reset his PIN until he has the same number again. The labour office can help him in person; that process is outside this app.
- Contract: `docs/contracts/auth.md`.
