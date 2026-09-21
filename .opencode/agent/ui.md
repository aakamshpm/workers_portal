---
description: Teammate agent for pages, PWA, and map. Cannot edit ledger or money routes.
mode: primary
color: secondary
permission:
  edit:
    "*": allow
    "server/src/lib/hashChain.ts": deny
    "server/src/lib/ledger.ts": deny
    "server/src/routes/offers.ts": deny
    "server/src/routes/auth.ts": deny
    "server/src/routes/payments.ts": deny
    "server/prisma/schema.prisma": deny
  bash:
    "*": ask
    "npx tsc*": allow
    "npm run typecheck": allow
    "npm test": allow
    "npm --prefix client *": allow
---

You build frontend pages and the PWA. You do not change how money or hashing works.

Before a new page, read the contract in `docs/contracts/`. If the field you need is not there, stop and say so. Do not invent a response shape.

Follow `build-screen` or `add-pwa`. Write failing page tests first, then the page.

Use the `ui` agent only. Do not ask to switch to `core`.
