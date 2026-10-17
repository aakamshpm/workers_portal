# Contract: complaints

The server implements these rules. The officer app and the contractor app consume them. ADR-0023, ADR-0013.

All routes require a valid JWT.

## Statuses

| Status | Meaning | Closed |
|---|---|---|
| `OPEN` | Filed, or the contractor has replied | No |
| `AWAITING_EMPLOYER` | The officer asked the contractor to explain | No |
| `RESOLVED` | Decided: upheld or settled | Yes |
| `REJECTED` | Decided: not upheld | Yes |
| `CLOSED_UNPROVEN` | Decided: nobody could prove it | Yes |
| `ESCALATED` | Sent to the Labour Commissioner or the Police | Yes |

A closed complaint is never changed again.

## Routes that change a complaint

| Route | Who | Status after |
|---|---|---|
| `POST /api/complaints/:id/ask-employer` | Labour officer | `AWAITING_EMPLOYER` |
| `POST /api/complaints/:id/employer-reply` | The contractor of that contract | `OPEN` |
| `POST /api/complaints/:id/contact` | Labour officer | unchanged |
| `POST /api/complaints/:id/decide` | Labour officer | `RESOLVED`, `REJECTED` or `CLOSED_UNPROVEN` |
| `POST /api/complaints/:id/escalate` | Labour officer | `ESCALATED` |

`decide` and `escalate` set `closedAt`.

## Errors

| Status | Code | When |
|---|---|---|
| `400` | none | The body is not valid. The message says which field |
| `403` | none | `employer-reply` from a contractor who is not on that contract |
| `404` | none | No complaint has that id |
| `409` | `COMPLAINT_CLOSED` | The complaint is closed. Nothing is written and no SMS is sent |

```json
{ "error": "This complaint is closed and cannot be changed.", "code": "COMPLAINT_CLOSED" }
```
