# Current state

What the running code does today.

## Working

- Phone + PIN sign-in, at `/`. A worker registers himself, with a phone code (see below). A contractor or labour officer cannot register; the labour office creates their accounts.
- Three separate apps from one Vite project (ADR-0012), each opening only for its own role: `/worker/`, `/contractor/`, `/officer/`. The officer app is a website only, no manifest. Access rules for who sees which records: ADR-0013, `server/src/lib/visibility.ts`.
- Offer → accept/decline → terms locked.
- Work periods (date range + day count). Payments. Worker OK/WRONG.
- Handover code is one-time, 15 minutes, not returned to the contractor.
- Employer statement (one sealed note, no figure change).
- Officer dispute review (not sealed, `confirmState` stays DISPUTED).
- Complaints: six statuses, four decide outcomes, escalate to Labour Commissioner or Police.
- Hash chain with HMAC-SHA-256 (`HMAC_SECRET`), seven types: OFFER, ACCEPT, WORK, PAYMENT, CONFIRM, DISPUTE, EMPLOYER_NOTE. Missing key fails startup.
- `rebuildPayload()` reads the live table row before hashing. Do not hash `LedgerEntry.payload` to verify a row.
- Postgres + PostGIS in Docker. `User` has opt-in `looking`, `latitude`, `longitude`, `preferredWorkType`. `Place` holds public business listings (not jobs).
- `SmsProvider` calls Textbee (`POST /gateway/send-sms`). Tests use a fake, never `api.textbee.dev`. `send()` fails when `TEXTBEE_API_KEY` is missing and writes no row. Inbound is a 30s poll (`src/lib/inbound.ts`) that stores each reply, deduped on the Textbee message id, and applies it through the same `respondToOffer` / `respondToRecord` the website uses. Checked on a real handset: offer SMS received, `YES` reply accepted the offer.
- Tests run against `wage_test` (`test/setup.ts`), never the development ledger.
- Discovery routes exactly as `docs/contracts/discovery.md`: `POST /api/discovery/toggle`, `GET /nearby-work`, `GET /nearby-workers`. Distance via `ST_DWithin`, response has `distanceKm` only. Place search through Photon, with a district-town fallback (ADR-0010), and one-time device location saved as the nearest town (ADR-0011). Worker-side page: Find Work (`client/src/worker/FindWorkPage.tsx`).
- Sign-in, registration, forgotten PIN and accounts made by the labour office (ADR-0014, contract `docs/contracts/auth.md`):
  - `POST /api/auth/code`: a 6-digit code by SMS, bcrypt-hashed, 10-minute expiry, one use, 5 wrong tries spend it, at most 1 a minute and 5 a day per phone. Same answer whether or not the number is registered.
  - `POST /api/auth/register`: a worker registers only with a code sent to that phone.
  - `POST /api/auth/reset-pin` ("Forgot PIN"): sets a new PIN with a code sent to the account's own phone, and clears the wrong-PIN lock.
  - `GET /api/accounts`, `POST /api/accounts`: labour officer only. Creates a contractor or officer account with no PIN; its owner sets one with "Forgot PIN". Officer app page: `client/src/officer/AccountsPage.tsx`.
  - `npm --prefix server run create-officer`: creates the first officer account, since none exists yet to make one in the app.
  - The development seed refuses to run except against a database on `localhost`/`127.0.0.1`/`::1`, and never when `NODE_ENV=production` (`server/prisma/seed-guard.ts`).
- Worker text in five languages: English, Hindi, Bengali, Malayalam, Odia (ADR-0015). The sign-in page and the worker app show text in the reader's language; the contractor and officer apps stay English. `PATCH /api/auth/language` saves a signed-in user's choice, so later SMS use it too. Dictionaries: `client/src/shared/i18n/`. Not yet checked by a native speaker of any of the four non-English languages.

## Development seed (PIN 1234)

| Phone | Name | Role |
|---|---|---|
| 9880030001 | Bijoy Das | WORKER |
| 9880030002 | Sanjay Kumar | WORKER |
| 9880030003 | Pramod Nayak | WORKER |
| 9880030004 | Rekha Munda | WORKER |
| 9000010001 | Ramesh Pillai | CONTRACTOR |
| 9000010002 | Suresh Menon | CONTRACTOR |
| 9000020001 | Anita Joseph | AUTHORITY |

After a clean seed: 7 users, 4 offers, 9 work periods, 4 payments, 32 ledger rows, 46 SMS rows, 2 complaints, 2 places.

## Invariants

1. Verification rebuilds from the live row (`server/src/lib/ledger.ts`).
2. Login PIN is never the handover proof (`HandoverCode`).
3. The work form shows the balance table before adding a line.
4. Seed deletes `HandoverCode`.
5. Each reader sees only the records his role and his own contracts allow (`server/src/lib/visibility.ts`, ADR-0013).
6. An account made by the labour office has no PIN until its owner sets one himself; the officer never learns it (ADR-0014).

## Not built yet

PWA, Find Workers (contractor side), officer SMS log page. Translations not reviewed by a native speaker.

## Commands

```bash
npm run db:up
npm run dev
npm test
npm run typecheck
npm --prefix server run create-officer -- --name "Name" --phone 9000020002
```
