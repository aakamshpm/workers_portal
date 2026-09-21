---
name: hmac-swap
description: Change computeHash from unkeyed SHA-256 to HMAC-SHA-256. Use when implementing ADR-0004. Core agent only.
---

# hmac-swap

1. Read `server/src/lib/hashChain.ts` and the existing tests in `server/test/`.
2. Write or update tests so they fail on the current unkeyed hash when a key is set.
3. Implement HMAC-SHA-256 with `HMAC_SECRET`. Tests set that env var.
4. `canonicalPayload` and `rebuildPayload` do not change.
5. Run the full `npm test` suite. All previous chain tests must still pass with the key present.
6. If `HMAC_SECRET` is missing, fail at startup. Do not silently use an empty key.
