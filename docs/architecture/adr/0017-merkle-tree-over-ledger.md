# ADR-0017: Merkle tree over the ledger

## Status

Accepted.

## Context

The ledger is a hash chain with HMAC-SHA-256 (ADR-0003, ADR-0004). `verifyLedger()` rebuilds every row from the live tables. That check has three limits:

1. A worker cannot check only his own record. The server must check the whole chain for him, and he must trust the answer.
2. Someone who has `HMAC_SECRET` and database access can change a row and recompute every hash after it. The chain then passes every check.
3. The check reads every row, so its time grows in a straight line with the ledger.

## Decision

- **A Merkle tree built from the chain, exactly as RFC 6962 (Certificate Transparency) defines it.** Leaf `i` is the 32 bytes of `LedgerEntry.currentHash` of the row with `chainIndex = i`. A leaf hash is `SHA-256(0x00 || leaf)` and an inner node is `SHA-256(0x01 || left || right)`. Because of the two prefixes, a leaf hash can never be passed off as an inner node hash. A tree of `n` leaves splits at the largest power of two below `n`, so any size works, not only powers of two.
- **Plain SHA-256 inside the tree, not HMAC.** Anyone can check a proof without the key, for example the worker's phone. The HMAC chain stays as it is, and it is still the check that the live row matches its record.
- **The tree is not stored.** It is computed from the `currentHash` column when needed. There is no schema change.
- **The code lives in `server/src/lib/merkle.ts`**, and has no database access: root, inclusion proof, consistency proof and the verification of both. `ledger.ts` gets one reader that returns the leaves in order. `rebuildPayload` and `verifyChain` are unchanged.
- **Inclusion proof:** about log₂(n) sibling hashes. They prove that one record is in the tree with a given root.
- **Consistency proof:** about log₂(n) hashes. They prove that the tree of size `m` is the first `m` leaves of the tree of size `n`, which means that no earlier row was changed, removed or reordered.
- **Published root.** A root is only useful against someone with the key if it was copied somewhere the operator cannot change later, such as an SMS to the officer, an email or a printed notice. This ADR does not decide where it is sent or stored. That comes in a later ADR, with routes.
- **Test vectors:** the RFC 6962 vectors from `transparency-dev/merkle` (`testonly/constants.go`) pin the hashing, so a wrong prefix or a wrong split point fails a test.

## Consequences

- The tamper simulation and `bench:verify` measure the hash chain and the tree against the same attacks (`docs/research/results/tamper.csv`, `verify_bench.csv`).
- A rewrite with the key is detected only when a root was published before the rewrite. Without publication, the tree gives no protection against the key holder.
- A proof shows that a record is in the ledger. It does not show that the live row still matches that record. The HMAC check in `verifyLedger()` still does that.
- No new service and no new dependency, since `node:crypto` provides SHA-256.
