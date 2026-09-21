# AGENTS.md

Index only. Load the linked file for the task. Do not change the stack without an ADR.

## What this is

Wage and grievance ledger for inter-state migrant workers in Kerala. One API. Worker uses PWA + SMS. Contractor uses PWA + website. Labour officer uses website only. Lead with the owed-wage number, not hashing.

## Always

- [`docs/project/principles.md`](docs/project/principles.md)
- [`docs/process/development-workflow.md`](docs/process/development-workflow.md)
- [`docs/process/teammate-boundaries.md`](docs/process/teammate-boundaries.md)

## First reads

1. [`docs/README.md`](docs/README.md)
2. [`docs/process/how-to-start.md`](docs/process/how-to-start.md)
3. [`docs/project/plan.md`](docs/project/plan.md)
4. [`docs/architecture/tech-stack.md`](docs/architecture/tech-stack.md)
5. [`docs/architecture/adr/README.md`](docs/architecture/adr/README.md)

## Skills

| Skill | Use when |
|---|---|
| `repo-onboarding` | New clone, “how is this organized?” |
| `write-adr` | Locking a decision |
| `build-screen` | New page against an existing contract |
| `add-pwa` | Manifest and service worker |
| `discovery-api` | Implementing nearby search (core only) |
| `hmac-swap` | Changing `computeHash` (core only) |
| `setup-postgres` | Prisma + PostGIS setup (core only) |
| `textbee-sms` | Wiring SMS (core only) |

## Agents

- `core` — full edit. Default for the core developer.
- `ui` — teammates. Cannot edit hash, ledger, offers, auth, payments, schema.
- `review` — read-only. Mention with `@review`.

## Progress

[`docs/project/plan.md`](docs/project/plan.md), [`docs/project/milestones.md`](docs/project/milestones.md), [`docs/project/current-state.md`](docs/project/current-state.md).
