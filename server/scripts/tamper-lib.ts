import { createHash } from "node:crypto";
import {
  GENESIS_HASH,
  canonicalPayload,
  computeHash,
  type ChainProblem,
  type StoredLink,
} from "../src/lib/hashChain";
import { consistencyProof, merkleRoot, verifyConsistency } from "../src/lib/merkle";

/**
 * ===========================================================================
 * Tamper simulation. ADR-0017, docs/phase2/research-brief.md (B4).
 * ===========================================================================
 *
 * An in-memory ledger in the app's own shape (StoredLink), attacked eight ways,
 * then checked three ways. No database, so every run gives the same answer.
 *
 * `currentPayload` stands for the live WorkOffer / Payment row, exactly as in
 * verifyLedger(): the check hashes the live row, never the ledger's own copy.
 *
 * Methods:
 *   chain_sha256            the chain with plain SHA-256 (before ADR-0004)
 *   chain_hmac              the chain with HMAC-SHA-256, as the app runs today
 *   chain_hmac_merkle_root  chain_hmac, plus a consistency proof against a Merkle
 *                           root published before the attack
 *
 * Attacker model: he can change any database row. For "with key" he also has
 * HMAC_SECRET. He cannot change a root that was already published. The attack
 * happens after the latest publication; rows added after it are protected only
 * when the next root is published.
 *
 * "row found": the first problem the chain check reports is at the changed row,
 * or at the row just after it (a deletion or insertion shows up there). The
 * Merkle check only answers "is today's ledger an extension of the published
 * one?", so it adds detection, never a row: for that method, "row found" comes
 * from its chain part.
 */

export type HashFn = (previousHash: string, payload: string) => string;

/** The app's hash: HMAC-SHA-256 with HMAC_SECRET (ADR-0004). */
export const hmacHash: HashFn = computeHash;

/** Plain SHA-256 over the same text. Anyone can compute it from the database alone. */
export const sha256Hash: HashFn = (previousHash, payload) =>
  createHash("sha256").update(`${previousHash}|${payload}`, "utf8").digest("hex");

export const ATTACKS = [
  "none",
  "edit_record",
  "delete_row",
  "delete_last_row",
  "insert_row",
  "reorder_rows",
  "rewrite_without_key",
  "rewrite_with_key",
] as const;
export type Attack = (typeof ATTACKS)[number];

export const METHODS = ["chain_sha256", "chain_hmac", "chain_hmac_merkle_root"] as const;
export type Method = (typeof METHODS)[number];

function payment(i: number, amount: number): string {
  return canonicalPayload({
    type: "PAYMENT",
    offerId: `offer-${Math.floor(i / 10)}`,
    workerId: `worker-${i % 7}`,
    amount,
    paidOn: new Date(Date.UTC(2026, 6, 1 + (i % 28))).toISOString(),
    method: "CASH",
    note: "",
  });
}

/** A valid chain of n payment records, sealed with `hash`. */
export function buildLedger(n: number, hash: HashFn): StoredLink[] {
  const links: StoredLink[] = [];
  let previousHash = GENESIS_HASH;
  for (let i = 0; i < n; i++) {
    const payload = payment(i, 1000 + i);
    const currentHash = hash(previousHash, payload);
    links.push({
      id: `entry-${i}`,
      chainIndex: i,
      recordType: "PAYMENT",
      recordId: `payment-${i}`,
      summary: `Payment ${i}`,
      payload,
      currentPayload: payload,
      previousHash,
      currentHash,
    });
    previousHash = currentHash;
  }
  return links;
}

/** The row each attack changes. */
export function targetRow(attack: Attack, n: number): number {
  return attack === "delete_last_row" ? n - 1 : Math.floor(n / 2);
}

/**
 * Apply one attack to a copy of the ledger. `chainHash` is the hash the ledger
 * was sealed with; the attacker uses it only when he has it (plain SHA-256 has
 * no key, so he always has that one).
 */
export function applyAttack(attack: Attack, original: StoredLink[], chainHash: HashFn): StoredLink[] {
  const links = original.map((l) => ({ ...l }));
  const k = targetRow(attack, links.length);
  const lowered = payment(k, 1); // the contractor lowers the amount to Rs 1

  /** Recompute hashes from row `from` onward, as someone rewriting history would. */
  const reseal = (from: number, hash: HashFn) => {
    for (let i = from; i < links.length; i++) {
      const prev = i === 0 ? GENESIS_HASH : links[i - 1]!.currentHash;
      links[i]!.previousHash = prev;
      links[i]!.currentHash = hash(prev, links[i]!.currentPayload!);
    }
  };

  switch (attack) {
    case "none":
      return links;

    case "edit_record":
      // The live row changes; the ledger rows are not touched.
      links[k]!.currentPayload = lowered;
      return links;

    case "delete_row":
    case "delete_last_row":
      links.splice(k, 1);
      return links;

    case "insert_row": {
      // A fake record at position k, with the following rows numbered one later.
      // Without the key he can only seal it with plain SHA-256.
      const payload = payment(k, 5);
      const previousHash = links[k - 1]!.currentHash;
      for (const l of links.slice(k)) l.chainIndex += 1;
      links.splice(k, 0, {
        id: "entry-fake",
        chainIndex: k,
        recordType: "PAYMENT",
        recordId: "payment-fake",
        summary: "Fake payment",
        payload,
        currentPayload: payload,
        previousHash,
        currentHash: sha256Hash(previousHash, payload),
      });
      return links;
    }

    case "reorder_rows": {
      // Rows k and k+1 swap places, and their numbers, so the order looks normal.
      const [a, b] = [links[k]!, links[k + 1]!];
      [a.chainIndex, b.chainIndex] = [b.chainIndex, a.chainIndex];
      links[k] = b;
      links[k + 1] = a;
      return links;
    }

    case "rewrite_without_key":
    case "rewrite_with_key":
      // He changes the live row and the ledger's copy, then recomputes every
      // hash from that row to the end.
      links[k]!.currentPayload = lowered;
      links[k]!.payload = lowered;
      reseal(k, attack === "rewrite_with_key" ? chainHash : sha256Hash);
      return links;
  }
}

/**
 * The same two checks as verifyChain() in hashChain.ts, with the hash passed
 * in, so the SHA-256 chain can be checked too. Only the problem and the row are
 * returned, in the same order as verifyChain(). A test checks that the two agree
 * for every attack.
 */
export function checkChain(links: StoredLink[], hash: HashFn): { chainIndex: number; problem: ChainProblem }[] {
  const out: { chainIndex: number; problem: ChainProblem }[] = [];
  links.forEach((link, position) => {
    if (link.chainIndex !== position) out.push({ chainIndex: link.chainIndex, problem: "INDEX_GAP" });
    if (link.currentPayload === null) {
      out.push({ chainIndex: link.chainIndex, problem: "RECORD_MISSING" });
    } else if (hash(link.previousHash, link.currentPayload) !== link.currentHash) {
      out.push({ chainIndex: link.chainIndex, problem: "HASH_MISMATCH" });
    }
    const expected = position === 0 ? GENESIS_HASH : links[position - 1]!.currentHash;
    if (link.previousHash !== expected) out.push({ chainIndex: link.chainIndex, problem: "BROKEN_LINK" });
  });
  return out;
}

function leavesOf(links: StoredLink[]): Buffer[] {
  return links.map((l) => Buffer.from(l.currentHash, "hex"));
}

/** Is today's ledger an extension of the one whose root was published? */
export function extendsPublished(published: { size: number; root: Buffer }, links: StoredLink[]): boolean {
  const leaves = leavesOf(links);
  if (leaves.length < published.size) return false;
  const proof = consistencyProof(leaves, published.size);
  return verifyConsistency(published.size, leaves.length, published.root, merkleRoot(leaves), proof);
}

export interface TamperResult {
  attack: Attack;
  method: Method;
  detected: boolean;
  rowFound: boolean;
  targetRow: number;
  /** The first row the chain check reported, or null when it reported nothing. */
  firstReported: number | null;
}

/** Every attack against every method, on a ledger of n rows. */
export function simulate(n: number): TamperResult[] {
  const results: TamperResult[] = [];

  for (const attack of ATTACKS) {
    const target = targetRow(attack, n);

    for (const method of METHODS) {
      const hash = method === "chain_sha256" ? sha256Hash : hmacHash;
      const original = buildLedger(n, hash);
      const published = { size: original.length, root: merkleRoot(leavesOf(original)) };

      const attacked = applyAttack(attack, original, hash);
      const failures = checkChain(attacked, hash);
      const first = failures.length ? Math.min(...failures.map((f) => f.chainIndex)) : null;

      const chainDetected = failures.length > 0;
      const rowFound = attack !== "none" && first !== null && (first === target || first === target + 1);
      const detected =
        method === "chain_hmac_merkle_root" ? chainDetected || !extendsPublished(published, attacked) : chainDetected;

      results.push({ attack, method, detected, rowFound, targetRow: target, firstReported: first });
    }
  }
  return results;
}
