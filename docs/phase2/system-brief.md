# System brief: Worker Pay Record

Paste this whole file into your AI tool before your own task brief. It describes the system as it is built today. Do not add features that are not written here.

## 1. The problem

Many migrant workers from West Bengal, Assam, Bihar, Jharkhand, Uttar Pradesh and Odisha work on construction sites in Kerala. A contractor agrees a daily wage with them by mouth. Later the contractor may:

- say a lower rate was agreed,
- write down fewer days than were worked,
- say he paid cash that the worker never received.

The worker has no written proof. Many read little English and some read little at all, but almost all have a phone that receives SMS.

## 2. What the system does

It is a wage and complaint record that neither side can change afterwards.

1. The contractor offers work: daily rate, number of days, site, start date. The offer reaches the worker by SMS and in the app.
2. The worker accepts by replying `YES 4821` by SMS or by tapping a button. **From that moment the rate is locked.** No screen and no API can change it.
3. The contractor records days worked and payments. The worker must confirm each one (`OK 4821`) or reject it (`WRONG 4821`, with his own number).
4. Each offer, acceptance, work record, payment, confirmation and dispute is added to a tamper-evident ledger (a hash chain, see section 7). Anyone can press "Check all records", and a changed row is shown in red.
5. When the two sides disagree, the worker files a complaint. A labour officer reviews it, asks the contractor to answer, decides it, or sends it to a higher office.
6. Workers can choose to be visible to contractors within a radius (nearby search, see section 8).

**The main number on every worker screen is how much he is still owed.** The hashing is how that number can be trusted. It is not the product.

## 3. Principles (these decide design questions)

1. **No edit, no delete.** A correction is a new row. There is no way to change an agreed rate.
2. **Identity is the phone number.** 10 digits and a 4-digit PIN. Workers register themselves. Contractors and officers are created by the labour office.
3. **The worker's YES is the lock.** Terms are sealed when the worker accepts, not when the contractor types them.
4. **The worker confirms every work and payment row** the contractor writes.
5. **SMS is real** and goes to the worker's own phone.
6. **Location is a town, never live GPS.** It is chosen by name or with one tap on "Use my location", and it is shared only if the worker turns it on.
7. **One app per role.** The worker and contractor apps are installable on a phone. The officer app is a website only.

## 4. Users (actors)

| Actor | How he uses it | Main goals |
|---|---|---|
| **Worker** | Phone app (installable) + SMS. His own language. | Accept or refuse offers, confirm or reject records, see what he is owed, find work nearby, ask the labour office for help |
| **Contractor** | Phone app + website. English. | Offer work, record days and payments, prove a payment, answer complaints, find workers nearby |
| **Labour officer** | Website only. English. | Review complaints and disputed records, decide cases, forward cases, create contractor and officer accounts, check the ledger |
| **SMS gateway** (external system) | Textbee service and one Android phone with a SIM | Delivers SMS to workers and brings their replies back |
| **Map/place service** (external system) | Photon (OpenStreetMap) | Turns a typed town name into a location |

## 5. Features by role (what is built)

**Everyone**
- Sign in with phone number and 4-digit PIN. After 5 wrong PINs the account locks for 15 minutes.
- "Forgot PIN": a 6-digit code comes by SMS, then the user sets a new PIN.

**Worker**
- Register: phone number → SMS code → name → home state → choose PIN → type PIN again.
- Language: English, Hindi, Bengali, Malayalam, Odia. It can be changed on every screen. His SMS use the same language.
- My work: offers waiting for an answer, records waiting for his check, and the amount still owed on each job.
- Find work: choose a town, see contractors hiring within a radius and public business listings, turn "Contractors can see me" on or off.
- Ask for help: file a complaint (category, amount, description) and see the status of his complaints.
- All records: the ledger rows of his own jobs, and "Check all records".

**Contractor**
- My workers: an offer form, offers waiting for an answer, a work-days form, the balance on each contract, complaints against him, and questions from the officer.
- Pay a worker, in one of three ways:
  - **Handover code:** the worker gets a one-time code by SMS and reads it out, and the contractor types it in. The code is valid for 15 minutes and for one amount. **The contractor never sees the code**, so he cannot pretend the worker read it out.
  - **UPI or bank:** the contractor enters the transaction number.
  - **Cash with no proof:** allowed, but marked "Nothing to show".
- All records: the ledger rows of his own contracts.

**Labour officer**
- Complaints: open cases, disputes waiting, closed cases. He can ask the contractor, record a phone call, decide (upheld, rejected, closed unproven), or forward to the Labour Commissioner or the Police.
- Disputed records: records the worker rejected without filing a complaint. The officer can mark them reviewed with a reason.
- All records: every ledger row.
- Accounts: create contractor and officer accounts. There is no PIN field. The owner sets his own PIN with "Forgot PIN", so the officer never knows it.

## 6. Data (database tables)

PostgreSQL. `id` is a text id (cuid). "→" means a foreign key.

| Table | Main fields | Meaning |
|---|---|---|
| **User** | id, phone (unique), name, role (WORKER / CONTRACTOR / AUTHORITY), pin (hash, can be empty), homeState, language, company, failedPinCount, lockedUntil, looking, latitude, longitude, locationName, preferredWorkType | Every person |
| **WorkOffer** | id, workerId → User, contractorId → User, dailyRate, workType, siteName, startDate, expectedDays, extraTerms, status (PENDING / ACCEPTED / DECLINED / CANCELLED), respondedAt, respondedVia (SMS / WEB), declineReason | One job offer, and after acceptance, the contract |
| **WorkPeriod** | id, offerId → WorkOffer, fromDate, toDate, days, note, confirmState (WAITING / CONFIRMED / DISPUTED), workerClaimsDays, disputeNote | Days worked, as written by the contractor |
| **Payment** | id, offerId → WorkOffer, amount, paidOn, method (CASH / UPI / BANK), proofType (NONE / CODE / REFERENCE), proofReference, confirmState, workerClaimsAmount, disputeNote | Money paid |
| **HandoverCode** | id, offerId, workerId, contractorId, amount, code, expiresAt, usedAt, paymentId | One-time code for a cash payment |
| **LedgerEntry** | id, chainIndex (unique, 0, 1, 2 …), recordType, recordId, workerId, summary, payload, previousHash, currentHash | The tamper-evident chain. One row per sealed event |
| **Complaint** | id, offerId → WorkOffer, raisedById → User, category (UNPAID / UNDERPAID / RATE_DISPUTE / DAYS_DISPUTE / CONDITIONS / OTHER), description, claimedAmount, status, outcome, outcomeNote | A worker's complaint |
| **ComplaintAction** | id, complaintId → Complaint, authorId → User, kind, note, escalatedTo (LABOUR_COMMISSIONER / POLICE) | Each step on a complaint |
| **EmployerStatement** | id, targetType (WORK / PAYMENT), targetId, offerId, contractorId, note | The contractor's one answer to a disputed record. It is sealed and cannot change any figure |
| **DisputeReview** | id, targetType, targetId, offerId, officerId, reason (SETTLED_OUTSIDE / DECIDED / NO_ACTION / UNPROVABLE), note | The officer's review of a disputed record |
| **SmsMessage** | id, userId → User, direction (OUT / IN), body, bodyEn, language, reference, kind, providerId, status | Every SMS sent or received, kept as a record for the officer |
| **PhoneCode** | id, phone, purpose (REGISTER / RESET_PIN), codeHash, attempts, expiresAt, usedAt | Sign-in codes. Only the hash is stored |
| **Town** | id, name, area, latitude, longitude | Kerala towns, used when the map service is down |
| **Place** | id, name, category, phone, latitude, longitude, source | Public business listings shown on the map. They are not job offers |

**Relationships:**
- A User (worker) receives many WorkOffers.
- A User (contractor) sends many WorkOffers.
- A WorkOffer has many WorkPeriods, Payments, Complaints, EmployerStatements and DisputeReviews.
- A Complaint has many ComplaintActions.
- A User has many SmsMessages.
- A LedgerEntry points to one row of WorkOffer, WorkPeriod or Payment through recordType and recordId. This is not a database foreign key.

## 7. Tamper evidence (how records are protected)

- Every sealed event adds one **LedgerEntry**. There are seven types: OFFER, ACCEPT, WORK, PAYMENT, CONFIRM, DISPUTE, EMPLOYER_NOTE.
- `currentHash = HMAC-SHA-256(secretKey, previousHash + "|" + payload)`. The first row uses previousHash `"0"`.
- The payload is a fixed text built from the record's own fields, for example the rate, the days and the dates.
- **Verification** walks the chain from row 0. For each row it **rebuilds the payload from the live table row**, not from a stored copy, and recomputes the hash. Suppose someone edits `dailyRate` in the WorkOffer table directly in the database. The rebuilt payload is then different, the hash does not match, and the row is shown in red with the changed field.
- It also detects a broken link (previousHash does not match the row before), a gap in chainIndex, and a missing record.
- **Known limit:** someone who has the secret key and database access could rebuild the whole chain. The research part (section 9) addresses this with a Merkle tree and a published root hash.
- This is **not a blockchain.** There is one organisation and no mining. See the research brief.

## 8. Nearby search

- A worker turns on "Contractors can see me" and chooses a town. Only the town's coordinates are stored, never live GPS.
- `GET /api/discovery/nearby-work?lat&lng&radiusKm`: the worker sees contractors within the radius. The radius is 1 to 50 km, and the default is 25.
- `GET /api/discovery/nearby-workers`: the contractor sees workers within the radius who have turned "looking" on.
- The distance is calculated in PostgreSQL with PostGIS: `ST_DWithin(point, centre, radiusMetres)`, with results sorted by distance. The response gives `distanceKm` only, never the other person's coordinates.
- Today there is no spatial index, so every search checks every row. The research part adds a **GiST index** and measures the speed-up.

## 9. Technology

| Part | Choice |
|---|---|
| Language | TypeScript |
| API server | Node.js + Express |
| Web apps | React + Vite. Three apps: `/worker/`, `/contractor/`, `/officer/`, plus the sign-in page at `/` |
| Styling | Tailwind CSS |
| Database | PostgreSQL + PostGIS (in Docker) |
| Database access | Prisma |
| Integrity | Hash chain with HMAC-SHA-256 |
| Mobile | Progressive Web App (installable from the browser, not a Play Store app) |
| SMS | Textbee (hosted API + one Android phone with a SIM) |
| Maps | Leaflet + OpenStreetMap. Place search through Photon |
| Tests | Node test runner (server), Vitest + Testing Library (pages) |

## 10. Main API routes

| Area | Routes |
|---|---|
| Auth | `POST /api/auth/login`, `/code`, `/register`, `/reset-pin`, `PATCH /api/auth/language`, `GET /api/auth/states` |
| Accounts (officer) | `GET /api/accounts`, `POST /api/accounts` |
| Offers and records | `GET/POST /api/offers`, `PATCH /api/offers/:id/respond`, `POST /api/offers/work`, `/payment`, `/confirm`, `/statement`, `GET /api/offers/balances`, `/awaiting`, `/disagreements` |
| Payments | `POST /api/payments/code`, `/confirm-code`, `/reference`, `GET /api/payments/history` |
| Ledger | `GET /api/ledger`, `POST /api/ledger/verify` |
| Complaints | `GET/POST /api/complaints`, `POST /api/complaints/:id/ask-employer`, `/employer-reply`, `/contact`, `/decide`, `/escalate`, `POST /api/complaints/dispute-review` |
| Discovery | `POST /api/discovery/toggle`, `GET /api/discovery/nearby-work`, `/nearby-workers`, `/places` |

## 11. SMS commands a worker can send

| Reply | Meaning |
|---|---|
| `YES 4821` / `NO 4821` | Accept or refuse offer 4821 |
| `OK 7314` / `WRONG 7314` | Confirm or reject record 7314 |
| `BAL` | Ask for the current balance |

The 4-digit number is a short reference printed in each SMS. The SMS gateway is checked every 30 seconds for new replies. A reply is handled by the same code as the button in the app.

## 12. Example data (use only these)

| Phone | Name | Role |
|---|---|---|
| 9880030001 | Bijoy Das | Worker, from West Bengal, reads Bengali |
| 9880030002 | Sanjay Kumar | Worker, from Bihar, reads Hindi |
| 9880030003 | Pramod Nayak | Worker, from Odisha, reads Odia |
| 9000010001 | Ramesh Pillai | Contractor, Ramesh Builders |
| 9000020001 | Anita Joseph | Labour officer |

Example offer: ₹900 a day, 20 days, "Construction - steel binding" at "Kakkanad Phase 2", starting 1 October 2026.
