# Repo layout

One git repository.

```
.
  AGENTS.md
  opencode.json
  compose/docker-compose.yml
  docs/
  .opencode/agent|skills|command
  server/                   # Express + Prisma
  client/                   # Vite + React, three apps (ADR-0012)
    index.html              # /            sign-in
    worker/index.html       # /worker/     worker app
    contractor/index.html   # /contractor/ contractor app
    officer/index.html      # /officer/    labour officer website
    src/
      shared/               # api, types, components, records page, sign-in
      worker/
      contractor/
      officer/
```
