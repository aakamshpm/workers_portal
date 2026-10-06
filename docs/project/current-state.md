# Current state

What the running code does today.

## Working

- Phone + PIN sign-in, at `/`. A worker registers himself, with a phone code (see below). A contractor or labour officer cannot register; the labour office creates their accounts.
- Three separate apps from one Vite project (ADR-0012), each opening only for its own role: `/worker/`, `/contractor/`, `/officer/`. The officer app is a website only, no manifest.
- PWA (ADR-0018): the worker and contractor apps each have their own manifest, icons and service worker, scoped to their own folder. An "Install app" button appears in the header only after the browser offers to install (in the worker's language). The service worker keeps the app page and build files so the app opens offline, and never stores `/api/` responses. Registered only in the production build: try it with `npm --prefix client run build` then `npm --prefix client run preview`. Icons: `npm --prefix client run icons`. The officer app has no manifest, no service worker and no button. Access rules for who sees which records: ADR-0013, `server/src/lib/visibility.ts`.
- Offer → accept/decline → terms locked.
- Work periods (date range + day count). Payments. Worker OK/WRONG.
- Handover code is one-time, 15 minutes, not returned to the contractor.
- Employer statement (one sealed note, no figure change).
- Officer dispute review (not sealed, `confirmState` stays DISPUTED).
- Complaints: six statuses, four decide outcomes, escalate to Labour Commissioner or Police.
- Hash chain with HMAC-SHA-256 (`HMAC_SECRET`), seven types: OFFER, ACCEPT, WORK, PAYMENT, CONFIRM, DISPUTE, EMPLOYER_NOTE. Missing key fails startup.
- `rebuildPayload()` reads the live table row before hashing. Do not hash `LedgerEntry.payload` to verify a row. `verifyLedger()` rebuilds through `rebuildPayloads()`, which reads the live rows with one query per table (chunks of 5,000 ids), not one per record: about 2 s at 1,00,000 rows.
- Merkle tree over the ledger (ADR-0017), `server/src/lib/merkle.ts`: RFC 6962 root, inclusion proof and consistency proof, checked against the published RFC 6962 test vectors. Leaves are the stored `currentHash` values (`ledgerLeaves()` in `ledger.ts`). Research only: no route, no page and no published root, by decision. Results are shown as tables from the experiments. Benchmark `npm --prefix server run bench:verify` and tamper simulation `npm --prefix server run tamper` write to `docs/research/results/`.
- Postgres + PostGIS in Docker. `User` has opt-in `looking`, `latitude`, `longitude`, `preferredWorkType`. `Place` holds public business listings (not jobs).
- `SmsProvider` calls Textbee (`POST /gateway/send-sms`). Tests use a fake, never `api.textbee.dev`. `send()` fails when `TEXTBEE_API_KEY` is missing and writes no row. Inbound is a 30s poll (`src/lib/inbound.ts`) that stores each reply, deduped on the Textbee message id, and applies it through the same `respondToOffer` / `respondToRecord` the website uses. Checked on a real handset: offer SMS received, `YES` reply accepted the offer.
- Tests run against `wage_test` (`test/setup.ts`), never the development ledger.
- Discovery routes exactly as `docs/contracts/discovery.md`: `POST /api/discovery/toggle`, `GET /nearby-work`, `GET /nearby-workers`. Distance via `ST_DWithin`, response has `distanceKm` only. GiST expression indexes `User_location_gist` (opted-in users only) and `Place_location_gist` (ADR-0016); the query text is in `server/src/lib/nearby.ts`, and a test checks the plan uses the index for the radius. Benchmark: `npm --prefix server run bench:search`, results in `docs/research/results/`. Place search through Photon, with a district-town fallback (ADR-0010), and one-time device location saved as the nearest town (ADR-0011). Worker-side page: Find Work (`client/src/worker/FindWorkPage.tsx`).
- Sign-in, registration, forgotten PIN and accounts made by the labour office (ADR-0014, contract `docs/contracts/auth.md`):
  - `POST /api/auth/code`: a 6-digit code by SMS, bcrypt-hashed, 10-minute expiry, one use, 5 wrong tries spend it, at most 1 a minute and 5 a day per phone. Same answer whether or not the number is registered.
  - `POST /api/auth/register`: a worker registers only with a code sent to that phone.
  - `POST /api/auth/reset-pin` ("Forgot PIN"): sets a new PIN with a code sent to the account's own phone, and clears the wrong-PIN lock.
  - `GET /api/accounts`, `POST /api/accounts`: labour officer only. Creates a contractor or officer account with no PIN; its owner sets one with "Forgot PIN". Officer app page: `client/src/officer/AccountsPage.tsx`.
  - `npm --prefix server run create-officer`: creates the first officer account, since none exists yet to make one in the app.
  - The development seed refuses to run except against a database on `localhost`/`127.0.0.1`/`::1`, and never when `NODE_ENV=production` (`server/prisma/seed-guard.ts`).
- One design system for the three apps (ADR-0019), taken from the Stitch design: tokens in `client/src/shared/theme.css`, fonts in `client/src/shared/fonts.css` (Noto, five scripts, served from the build), inline SVG icons in `client/src/shared/components/Icon.tsx` (`npm --prefix client run icons:fetch` regenerates `icons.ts`), and shared components in `client/src/shared/components/` (`AppHeader`, `Button`, `Card`, `TextField`, `Field`, `Note`, `ChoiceRow`, `EmptyState`, `DigitBoxes`). The sign-in page (S1–S6) and the worker app are rebuilt on it. The worker app has the design's phone frame (W1): app name, language list and one account button in the header, with name, phone, home state and "Sign out" behind that button, and the four sections as a bar at the foot of the screen. Records show as one card per record on a phone and as a table on a wide screen. The money card, the record check and the record badges are in the worker's language. Checked in a browser at 320, 360 and 390px in all five languages: nothing scrolls sideways, no text is cut, no phone number or date breaks over two lines. The contractor app has the same phone frame (three sections, account button, no language list), and its Pay a worker page is rebuilt on the theme: the three ways of paying are one group of finger-high buttons, the job list names worker and site only, and the two badges of a payment sit together. The My workers page is rebuilt too: the money still owed first in one panel, the two forms (offer work, write down work) closed until asked for and open one at a time, and the labour office's question answered in the same page. Checked in a browser at 320, 360 and 390px, with each form open. The officer website (ADR-0021) has a top bar with the officer's name, office and "Sign out", and a sidebar of four sections: Complaints, Disputed records, All records, Accounts. From 1024px the sidebar stands at the left and stays in view, and below that it is a row under the top bar. Disputed records is a page of its own (`client/src/officer/DisputedRecordsPage.tsx`), and the count of disputes waiting on the Complaints page links to it. All four pages are on the theme. Checked in a browser at 768, 1024 and 1280px, with the decision form and the review form open: nothing scrolls sideways and no text is cut. A pointer cursor shows on everything that can be pressed, and "not allowed" on a disabled control. Every page frame is as tall as the visible screen (`min-h-dvh`), not the screen with the address bar hidden (`100vh`), so the foot of the sign-in page is not below the edge of a phone.
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

Find Workers (contractor side), officer SMS log page. Translations not reviewed by a native speaker.

## Commands

```bash
npm run db:up
npm run dev
npm test
npm run typecheck
npm --prefix server run create-officer -- --name "Name" --phone 9000020002
```
