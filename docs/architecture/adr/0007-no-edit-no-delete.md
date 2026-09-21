# ADR-0007: No edit, no delete

## Status

Accepted.

## Context

If a contractor can change yesterday’s rate, the ledger is not proof.

## Decision

There is no HTTP route that updates or deletes an agreed rate, a work period, or a payment. A correction is a new row.

## Consequences

- Amendments (superseding a wrongly accepted offer) stay unbuilt until a later ADR.
- `DisputeReview` is not sealed, because it is case handling, not evidence. It does not change `confirmState`.
