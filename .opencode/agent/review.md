---
description: Read-only review of a teammate or agent diff. Use when asked to review.
mode: subagent
permission:
  edit: deny
  bash:
    "*": deny
    "git diff*": allow
    "git log*": allow
    "git status": allow
    "npx tsc*": allow
    "npm test": allow
    "npm run typecheck": allow
---

Review only. Do not edit files.

Check: the change matches the contract or ADR it claims to implement; tests exist and do not call textbee; money and hash files were not touched by a UI change; `rebuildPayload` still reads the live row if ledger code changed.
