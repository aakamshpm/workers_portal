import { createHash } from "node:crypto";

/**
 * ===========================================================================
 * Merkle tree over the ledger. ADR-0017.
 * ===========================================================================
 *
 * Exactly the tree of RFC 6962 / RFC 9162 section 2.1 (Certificate
 * Transparency), so any verifier written for that standard can check our proofs.
 *
 *   leaf hash   SHA-256(0x00 || leaf)
 *   inner hash  SHA-256(0x01 || left || right)
 *   empty tree  SHA-256("")
 *
 * The different first bytes mean a leaf hash and an inner hash are never
 * computed over the same input, so someone cannot give two inner hashes as one
 * 64-byte "leaf" and get the same root (a second-preimage attack).
 *
 * A tree of n leaves splits at k, the largest power of two smaller than n. The
 * left side is always a complete tree of k leaves. This is what lets the tree
 * grow one leaf at a time without changing any earlier complete subtree, and so
 * lets the consistency proof exist.
 *
 * Plain SHA-256, not HMAC: a proof must be checkable without the server's key,
 * for example on the worker's phone. The HMAC chain stays as it is.
 *
 * No database access in this file. `ledgerLeaves()` in ledger.ts reads the
 * leaves (the currentHash of each row, in chainIndex order).
 *
 * Proof generation below computes subtree hashes from the leaves each time, which
 * costs O(n) hashes. Verification costs O(log n). The tree is not stored.
 */

const LEAF = Buffer.from([0x00]);
const NODE = Buffer.from([0x01]);

export function leafHash(leaf: Buffer): Buffer {
  return createHash("sha256").update(LEAF).update(leaf).digest();
}

export function nodeHash(left: Buffer, right: Buffer): Buffer {
  return createHash("sha256").update(NODE).update(left).update(right).digest();
}

/** Largest power of two strictly smaller than n. Requires n > 1. */
function splitPoint(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

/** MTH(D[from:to]) from RFC 6962, on index ranges so no arrays are copied. */
function subtreeHash(leaves: Buffer[], from: number, to: number): Buffer {
  const n = to - from;
  if (n === 0) return createHash("sha256").digest();
  if (n === 1) return leafHash(leaves[from]!);
  const k = splitPoint(n);
  return nodeHash(subtreeHash(leaves, from, from + k), subtreeHash(leaves, from + k, to));
}

/** The root of the tree over all the leaves. */
export function merkleRoot(leaves: Buffer[]): Buffer {
  return subtreeHash(leaves, 0, leaves.length);
}

// ---------------------------------------------------------------------------
// Inclusion proof: "leaf i is in the tree with this root"
// ---------------------------------------------------------------------------

/**
 * PATH(m, D[n]) from RFC 6962 2.1.1: the sibling hash at each level, from the
 * leaf upwards. At most ceil(log2 n) hashes.
 */
export function inclusionProof(leaves: Buffer[], index: number): Buffer[] {
  if (!Number.isInteger(index) || index < 0 || index >= leaves.length) {
    throw new RangeError(`leaf ${index} is not in a tree of ${leaves.length}`);
  }
  const path = (m: number, from: number, to: number): Buffer[] => {
    const n = to - from;
    if (n === 1) return [];
    const k = splitPoint(n);
    return m < k
      ? [...path(m, from, from + k), subtreeHash(leaves, from + k, to)]
      : [...path(m - k, from + k, to), subtreeHash(leaves, from, from + k)];
  };
  return path(index, 0, leaves.length);
}

/**
 * RFC 9162 2.1.3.2. `fn` is the position of the node we have, `sn` the position
 * of the last node, both at the current level. When fn is a right child, or the
 * last node of its level with no right sibling, the proof hash goes on the left.
 * A last node with no sibling is carried up unchanged, which is the inner loop.
 */
export function verifyInclusion(
  index: number,
  treeSize: number,
  leafHashValue: Buffer,
  proof: Buffer[],
  root: Buffer,
): boolean {
  if (!Number.isInteger(index) || !Number.isInteger(treeSize) || index < 0 || index >= treeSize) return false;

  let fn = index;
  let sn = treeSize - 1;
  let r = leafHashValue;

  for (const p of proof) {
    if (sn === 0) return false; // more hashes than levels
    if (fn % 2 === 1 || fn === sn) {
      r = nodeHash(p, r);
      if (fn % 2 === 0) {
        while (fn % 2 === 0 && fn !== 0) {
          fn = Math.floor(fn / 2);
          sn = Math.floor(sn / 2);
        }
      }
    } else {
      r = nodeHash(r, p);
    }
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }

  return sn === 0 && r.equals(root);
}

// ---------------------------------------------------------------------------
// Consistency proof: "the old tree is the first m leaves of the new tree"
// ---------------------------------------------------------------------------

/**
 * PROOF(m, D[n]) from RFC 6962 2.1.2. It shows that a root published when the
 * ledger had m rows is still the root of today's first m rows, which means that
 * no earlier row was changed, removed or reordered since.
 */
export function consistencyProof(leaves: Buffer[], oldSize: number): Buffer[] {
  const n = leaves.length;
  if (!Number.isInteger(oldSize) || oldSize < 0 || oldSize > n) {
    throw new RangeError(`cannot prove ${oldSize} -> ${n}`);
  }
  if (oldSize === 0 || oldSize === n) return [];

  const sub = (m: number, from: number, to: number, complete: boolean): Buffer[] => {
    const size = to - from;
    if (m === size) return complete ? [] : [subtreeHash(leaves, from, to)];
    const k = splitPoint(size);
    return m <= k
      ? [...sub(m, from, from + k, complete), subtreeHash(leaves, from + k, to)]
      : [...sub(m - k, from + k, to, false), subtreeHash(leaves, from, from + k)];
  };
  return sub(oldSize, 0, n, true);
}

/**
 * RFC 9162 2.1.4.2. Two roots are rebuilt from the same proof: `fr` for the old
 * tree and `sr` for the new one. Both must match, which is only possible when
 * the old tree's leaves are unchanged inside the new tree.
 */
export function verifyConsistency(
  oldSize: number,
  newSize: number,
  oldRoot: Buffer,
  newRoot: Buffer,
  proof: Buffer[],
): boolean {
  if (!Number.isInteger(oldSize) || !Number.isInteger(newSize) || oldSize < 0 || oldSize > newSize) return false;
  if (oldSize === newSize) return proof.length === 0 && oldRoot.equals(newRoot);
  if (oldSize === 0) return proof.length === 0;
  if (proof.length === 0) return false;

  // When the old tree is a complete tree, its root is a node of the new tree
  // and the proof leaves it out, because the verifier already has it.
  const path = (oldSize & (oldSize - 1)) === 0 ? [oldRoot, ...proof] : proof;

  let fn = oldSize - 1;
  let sn = newSize - 1;
  while (fn % 2 === 1) {
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }

  let fr = path[0]!;
  let sr = path[0]!;

  for (const c of path.slice(1)) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      fr = nodeHash(c, fr);
      sr = nodeHash(c, sr);
      if (fn % 2 === 0) {
        while (fn % 2 === 0 && fn !== 0) {
          fn = Math.floor(fn / 2);
          sn = Math.floor(sn / 2);
        }
      }
    } else {
      sr = nodeHash(sr, c);
    }
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }

  return sn === 0 && fr.equals(oldRoot) && sr.equals(newRoot);
}
