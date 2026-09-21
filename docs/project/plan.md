# Plan (A to Z)

The ordered build for this product. Status lives in [`milestones.md`](milestones.md). Decisions live in [`../architecture/adr/`](../architecture/adr/). This file is the sequence. Update it when the order changes.

## Product

One API. Three clients, chosen by role after login.

| Role | Clients |
|---|---|
| Worker | PWA + SMS on their own phone |
| Contractor | Website + PWA |
| Labour officer | Website only |

The number the worker must be able to show:

```
agreed rate × days worked − already paid = what I am owed
```

Nearby search is opt-in. Location is typed, never a live GPS stream. Public map listings are businesses, not jobs.

SMS uses Textbee’s hosted API and one Android phone as the modem. Develop on localhost. Outbound is a POST from the API. Inbound is a poll of Textbee. A public webhook and hosting come last.

Agents write the failing test, run it, write the code, run the tests again. A human checks the running product at the end of a milestone, not between red and green.

## 0. Structure

Docs, ADRs, OpenCode agents (`core`, `ui`, `review`), skills, and `docs/contracts/discovery.md`. One repository. No submodules.

Done when a new clone can follow [`../process/how-to-start.md`](../process/how-to-start.md) and an agent loads this file from `AGENTS.md`.

## 1. Platform

Core agent only. Skills: `setup-postgres`, `hmac-swap`, `textbee-sms`, `discovery-api`.

1. Postgres + PostGIS in Docker. Prisma talks to Postgres. Seed keeps the seven people and the existing wage stories, and adds coordinates around Ernakulam plus public `Place` rows.
2. HMAC-SHA-256 in `computeHash`. Key is `HMAC_SECRET`. Missing key fails startup. Tests never use an empty key.
3. `SmsProvider`: production calls Textbee; tests inject a fake. `send()` fails if `TEXTBEE_API_KEY` is missing. Audit rows stay in `SmsMessage`. Poll inbound and pass bodies through `parseReply`.
4. Three discovery routes exactly as [`../contracts/discovery.md`](../contracts/discovery.md). Distance via `ST_DWithin`. No live coordinates in the response.

Human work in this milestone: Textbee account, Android app, API key in `server/.env`, gateway phone left on.

Done when `npm test` and both typechecks pass against Postgres, and one real SMS reaches a team phone when the key is set.

## 2. Worker product

Teammates on pages (`ui` + `build-screen` + `add-pwa`). Core only if a route is wrong.

1. PWA install prompt on worker routes.
2. Find Work: contractors who opted in, plus public listings labelled as businesses.
3. Existing `/work`, `/help`, `/records` keep working.
4. SMS on the worker’s own phone is the second client (offer, YES/NO, work/pay confirm, handover code, BAL). `/phone` is an audit view, not the handset.

Done when a worker can install the PWA, search nearby, receive an offer SMS, and reply `YES` from the Messages app.

## 3. Contractor product

1. Same PWA, install prompt on contractor routes.
2. Website in the browser unchanged in role.
3. Find Workers: opted-in workers, `distanceKm` only.
4. Existing offer, work log, pay, and employer reply keep working. Sending an offer still sends a real SMS.

Done when a contractor can install the PWA, find an opted-in worker, send an offer, and the worker’s phone receives it.

## 4. Labour office product

Website only. No install prompt. No hiring map.

Existing complaints, dispute review, track record, four outcomes, two destinations. Officer can read the SMS audit log (what was sent, what was replied).

Done when an officer can finish a complaint on `/complaints` and cannot see Find Work / Find Workers or a PWA prompt.

## 5. Close

1. Rewrite human-facing README and any walkthrough so they match the screens that exist.
2. Host the API. Replace inbound poll with a Textbee webhook.
3. Full run on a real SIM: register, offer SMS, `YES`, work confirm, `OK`.
4. Mark milestones Done.

## Out of scope until a new ADR

Superseding a wrongly accepted offer. A commercial DLT SMS route. Self-hosting Textbee. Capacitor / native apps. Live GPS. Blockchain. Signed paper receipts. Pagination of the ledger.

## Who owns what

| Track | Agent | Files |
|---|---|---|
| Schema, HMAC, SMS, discovery routes | `core` | `server/prisma/`, `hashChain.ts`, `ledger.ts`, `lib/sms.ts`, `routes/discovery.ts` |
| Find Work | `ui` | new worker page |
| Find Workers | `ui` | new contractor page |
| PWA + map | `ui` | manifest, service worker, `MapView.tsx` |
| Labour office pass | `ui` | no new hiring UI on officer routes |

`ui` cannot edit hash, ledger, offers, auth, payments, or `schema.prisma`. See [`../process/teammate-boundaries.md`](../process/teammate-boundaries.md).
