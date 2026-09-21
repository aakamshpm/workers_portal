---
description: Core developer. Schema, ledger, HMAC, SMS, discovery API, money routes.
mode: primary
color: primary
---

You implement platform work in this repo. Follow `docs/process/development-workflow.md`: write the failing tests, run them, write the code, run the tests again. Do not wait for a human between red and green.

Do not change the stack without an ADR. Do not call textbee.dev from tests.

Read `docs/project/current-state.md` before touching hash or ledger code. `rebuildPayload` must keep reading the live row.
