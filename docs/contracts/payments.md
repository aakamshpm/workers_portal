# Contract: cash handover code

The server implements these rules. The contractor's Pay a worker page consumes them. ADR-0024.

All routes require a valid JWT of a contractor, and the contract must be his.

## POST /api/payments/code

Body: `{ "offerId": "…", "amount": 8000 }`

Sends a 4-digit code to the worker's phone by SMS and replaces any earlier live code for that worker. The code is never in the response.

- The code is 4 digits, from the operating system's random source.
- It expires after 15 minutes.
- It works once.
- Five wrong tries spend it.

Response `201`: `{ "sent": true, "workerName": "…", "workerPhone": "…", "amount": 8000, "expiresAt": "…", "expiresInMinutes": 15, "message": "…" }`

## POST /api/payments/confirm-code

Body: `{ "offerId": "…", "code": "1234", "paidOn": "2026-10-17", "note": "optional" }`

A right code records the cash payment and the worker's confirmation in one transaction.

Response `201`: `{ "recorded": true, "proofType": "CODE", "amount": 8000, "workerName": "…", "ref": "…", "balance": { … }, "message": "…" }`

| Status | Code | When |
|---|---|---|
| `400` | `CODE_WRONG` | The code is wrong. The body also has `triesLeft`, which is 1 to 4 |
| `409` | `CODE_SPENT` | That was the fifth wrong try, or the code already had five |
| `409` | `CODE_EXPIRED` | The code is older than 15 minutes |
| `404` | `NO_CODE` | No code is waiting for this contract, or it was already used |

```json
{ "error": "That code is wrong. 3 tries left.", "code": "CODE_WRONG", "triesLeft": 3 }
```

After `CODE_SPENT`, `CODE_EXPIRED` or `NO_CODE`, the contractor must send a new code. Wrong tries are counted only for a live code, so a try with no code waiting, or on an expired code, changes nothing.

If two requests with the right code arrive together, exactly one records the payment. The other gets `404 NO_CODE`.

## GET /api/payments/pending-code

The code the contractor is waiting on, so the page survives a refresh: `{ "offerId": "…", "amount": 8000, "expiresAt": "…", "workerId": "…", "worker": { "name": "…", "phone": "…" } }`, or `null`.

A code that is used, expired or spent is not waiting, so the answer is `null`. The code value is never included.
