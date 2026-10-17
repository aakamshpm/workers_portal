# ADR-0023: A complaint is closed once it is decided or escalated

## Status

Accepted.

## Context

A complaint has six statuses. Four of them end the case: `RESOLVED`, `REJECTED` and `CLOSED_UNPROVEN` come from a decision, and `ESCALATED` means the case went to the Labour Commissioner or the Police. The schema and the diagrams brief already treat all four as end states, and the disputed-records route counts all four as closed.

The routes did not agree:

- `escalate` had no status check, so a decided case could still be sent to the Police, and the worker was sent an SMS saying so.
- `decide` accepted an escalated case, so the labour office could record a decision after it had handed the case to another office.
- `ask-employer` refused only `RESOLVED` and `REJECTED`.
- `employer-reply` had no status check, and it sets the status to `OPEN`. A contractor could reopen a decided case by replying to it.
- `contact` had no status check, and it can send the worker an SMS.
- The officer page listed escalated cases as open, with all four action buttons.

## Decision

- **`RESOLVED`, `REJECTED`, `CLOSED_UNPROVEN` and `ESCALATED` are closed.** One function in `server/src/routes/complaints.ts` says which statuses are closed, and every route that changes a complaint uses it.
- **The five routes that change a complaint refuse a closed one** with `409` and the error code `COMPLAINT_CLOSED`: `ask-employer`, `employer-reply`, `contact`, `decide`, `escalate`. Nothing is written and no SMS is sent.
- **Escalating sets `closedAt`**, as a decision does, so an escalated case has the date it left the office.
- **The officer page lists escalated cases with the closed cases**, with no action buttons.

## Consequences

- What the higher office decides is not recorded in this system. If that is needed later, it is a new kind of entry with its own ADR, not a change to the closed complaint (principle 1).
- A worker who has a new problem after a case is closed files a new complaint.
- Contract: `docs/contracts/complaints.md`.
