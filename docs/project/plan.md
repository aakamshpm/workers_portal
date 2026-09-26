# Plan (A to Z)

The ordered build for this product. Status lives in [`milestones.md`](milestones.md). Decisions live in [`../architecture/adr/`](../architecture/adr/). This file is the sequence. Update it when the order changes.

## Product

One API. Three separate apps, one per role, built from one Vite project ([ADR-0012](../architecture/adr/0012-three-apps-one-vite-project.md)). Everyone signs in at `/`, and the phone number decides which app opens.

| Role | App | Clients |
|---|---|---|
| Worker | `/worker/` | Installable app + SMS on their own phone |
| Contractor | `/contractor/` | Website, installable as an app |
| Labour officer | `/officer/` | Website only, never installable |

The number the worker must be able to show:

```
agreed rate × days worked − already paid = what I am owed
```

Nearby search is opt-in. Location is a chosen town, by name or one tap on "Use my location", never a live GPS stream ([ADR-0011](../architecture/adr/0011-one-time-device-location.md)). Public map listings are businesses, not jobs.

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

1. Split the client into three apps (ADR-0012). The worker app lives at `/worker/`.
2. PWA install prompt in the worker app only.
3. Find Work: contractors who opted in, plus public listings labelled as businesses.
4. Existing worker pages (my work, ask for help, records) keep working.
5. SMS on the worker’s own phone is the second client (offer, YES/NO, work/pay confirm, handover code, BAL). There is no in-app phone page: the worker reads SMS on his own phone.

Done when a worker can install the PWA, search nearby, receive an offer SMS, and reply `YES` from the Messages app.

## 3. Contractor product

1. The contractor app at `/contractor/`, with its own install prompt and manifest.
2. The same app works as a website in the browser.
3. Find Workers: opted-in workers, `distanceKm` only.
4. Existing offer, work log, pay, and employer reply keep working. Sending an offer still sends a real SMS.

Done when a contractor can install the PWA, find an opted-in worker, send an offer, and the worker’s phone receives it.

## 4. Labour office product

The officer app at `/officer/`. Website only: no manifest, so no browser can offer to install it. No hiring map.

Existing complaints, dispute review, track record, four outcomes, two destinations. Officer can read the SMS audit log (what was sent, what was replied).

Done when an officer can finish a complaint in the officer app, and the officer app has no Find Work / Find Workers and cannot be installed.

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
| Find Work | `ui` | `client/src/worker/` |
| Find Workers | `ui` | `client/src/contractor/` |
| PWA + map | `ui` | manifests (worker and contractor only), service worker, `MapView.tsx` |
| Labour office pass | `ui` | no new hiring UI on officer routes |

`ui` cannot edit hash, ledger, offers, auth, payments, or `schema.prisma`. See [`../process/teammate-boundaries.md`](../process/teammate-boundaries.md).
