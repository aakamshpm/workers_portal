---
name: repo-onboarding
description: Orient a new contributor to repo layout, agents, and first commands. Use when cloning, asking how the repo is organized, or onboarding.
---

# repo-onboarding

1. Point at root `AGENTS.md` and `docs/README.md`.
2. Layout: one repo, `server/` + `client/`, docs in `docs/`.
3. Reading order: `docs/process/how-to-start.md` → `docs/architecture/tech-stack.md` → ADRs.
4. Agents: core developer uses `core`. Teammates use `ui`. `@review` for diffs.
5. Database is Postgres in Docker: `npm run db:up`.
6. Textbee setup is human: Android app + API key in `server/.env`.
