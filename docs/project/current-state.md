# Current state

What the running code does today.

## Working

- Phone + PIN login. Worker self-register. Role forced to WORKER on register.
- Offer → accept/decline → terms locked.
- Work periods (date range + day count). Payments. Worker OK/WRONG.
- Handover code is one-time, 15 minutes, not returned to the contractor.
- Employer statement (one sealed note, no figure change).
- Officer dispute review (not sealed, `confirmState` stays DISPUTED).
- Complaints: six statuses, four decide outcomes, escalate to Labour Commissioner or Police.
- Hash chain with HMAC-SHA-256 (`HMAC_SECRET`), seven types: OFFER, ACCEPT, WORK, PAYMENT, CONFIRM, DISPUTE, EMPLOYER_NOTE. Missing key fails startup.
- `rebuildPayload()` reads the live table row before hashing. Do not hash `LedgerEntry.payload` to verify a row.
- Postgres + PostGIS in Docker. `User` has opt-in `looking`, `latitude`, `longitude`, `preferredWorkType`. `Place` holds public business listings (not jobs).
- `SmsProvider` calls Textbee (`POST /gateway/send-sms`). Tests use a fake, never `api.textbee.dev`. `send()` fails when `TEXTBEE_API_KEY` is missing and writes no row. Inbound is a 30s poll, bodies go through `parseReply`.
- Discovery routes exactly as `docs/contracts/discovery.md`: `POST /api/discovery/toggle`, `GET /nearby-work`, `GET /nearby-workers`. Distance via `ST_DWithin`, response has `distanceKm` only.

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

## Not built yet

PWA, Find Work / Find Workers.

## Commands

```bash
npm run db:up
npm run dev
npm test
npm run typecheck
```
