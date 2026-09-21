# ADR-0003: Hash chain, not a blockchain

## Status

Accepted.

## Context

The system has one operator. A blockchain solves disagreement between many operators. There are no miners and no consensus to run.

## Decision

Keep the existing append-only hash chain in `server/src/lib/hashChain.ts`. Do not add a blockchain.

## Consequences

- `verifyChain` continues to rebuild from live rows (`rebuildPayload`).
- The known limit remains: a full rewrite of every row can produce a consistent chain. HMAC (ADR-0004) raises the cost of that rewrite. An external paper receipt is still out of scope unless a later ADR adds it.
