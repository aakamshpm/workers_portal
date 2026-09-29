import "./setup";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  consistencyProof,
  inclusionProof,
  leafHash,
  merkleRoot,
  verifyConsistency,
  verifyInclusion,
} from "../src/lib/merkle";
import { CONSISTENCY, INCLUSION, LEAF_HASHES, LEAF_INPUTS, ROOTS } from "./merkle-vectors";

/**
 * ADR-0017. What these tests guarantee:
 *
 *   1. The hashing is exactly RFC 6962: the 0x00 / 0x01 prefixes and the split
 *      at the largest power of two below n. Checked against the published
 *      vectors, so a proof we produce can be checked by any RFC 6962 verifier.
 *   2. An inclusion proof verifies for every leaf of every tree size, and fails
 *      when the leaf, the index, the size, the root or any proof hash changes.
 *   3. A consistency proof verifies for every older size m <= n, and fails when
 *      any old leaf was changed, which is the "history rewritten" attack.
 *   4. A proof has at most ceil(log2 n) hashes.
 *   5. A pair of inner nodes cannot be passed off as one leaf.
 */

const hex = (b: Buffer) => b.toString("hex");
const buf = (h: string) => Buffer.from(h, "hex");
const vectorLeaves = LEAF_INPUTS.map(buf);

/** n distinct 32-byte leaves, like LedgerEntry.currentHash values. */
function leaves(n: number): Buffer[] {
  return Array.from({ length: n }, (_, i) => Buffer.alloc(32, 0).fill(i % 256, 0, 16).fill(Math.floor(i / 256), 16));
}

function flipBit(b: Buffer): Buffer {
  const c = Buffer.from(b);
  c[0] = c[0]! ^ 1;
  return c;
}

describe("merkle: RFC 6962 hashing", () => {
  it("leaf hash is SHA-256(0x00 || leaf)", () => {
    vectorLeaves.forEach((leaf, i) => assert.equal(hex(leafHash(leaf)), LEAF_HASHES[i]));
  });

  it("root of the first k vector leaves matches the published root, k = 0..8", () => {
    for (let k = 0; k <= 8; k++) {
      assert.equal(hex(merkleRoot(vectorLeaves.slice(0, k))), ROOTS[k], `size ${k}`);
    }
  });

  it("two inner hashes given as one leaf do not give the same root", () => {
    const [a, b] = [buf("aa"), buf("bb")];
    const forged = Buffer.concat([leafHash(a), leafHash(b)]);
    assert.notEqual(hex(merkleRoot([forged])), hex(merkleRoot([a, b])));
  });
});

describe("merkle: inclusion proof", () => {
  it("produces the published proofs", () => {
    for (const v of INCLUSION) {
      const proof = inclusionProof(vectorLeaves.slice(0, v.treeSize), v.leafIndex);
      assert.deepEqual(proof.map(hex), v.proof, `leaf ${v.leafIndex} of ${v.treeSize}`);
    }
  });

  it("verifies the published proofs", () => {
    for (const v of INCLUSION) {
      assert.equal(verifyInclusion(v.leafIndex, v.treeSize, buf(v.leafHash), v.proof.map(buf), buf(v.root)), true);
    }
  });

  it("verifies every leaf of every size up to 40, with at most ceil(log2 n) hashes", () => {
    for (let n = 1; n <= 40; n++) {
      const ls = leaves(n);
      const root = merkleRoot(ls);
      for (let i = 0; i < n; i++) {
        const proof = inclusionProof(ls, i);
        assert.ok(proof.length <= Math.ceil(Math.log2(n)), `size ${n}: ${proof.length} hashes`);
        assert.equal(verifyInclusion(i, n, leafHash(ls[i]!), proof, root), true, `leaf ${i} of ${n}`);
      }
    }
  });

  it("fails when the leaf, index, size, root or a proof hash is wrong", () => {
    const ls = leaves(13);
    const root = merkleRoot(ls);
    const i = 6;
    const proof = inclusionProof(ls, i);
    const lh = leafHash(ls[i]!);

    assert.equal(verifyInclusion(i, 13, leafHash(flipBit(ls[i]!)), proof, root), false, "changed leaf");
    assert.equal(verifyInclusion(i + 1, 13, lh, proof, root), false, "wrong index");
    // A size with the same path shape (12 here: both split 8 | rest, and leaf 6
    // is in the left 8) rebuilds the same root, so it is not a failure case. The
    // size is bound to the root by publishing both together (a tree head), not
    // by the proof. A size whose shape differs must fail.
    assert.equal(verifyInclusion(i, 8, lh, proof, root), false, "wrong size");
    assert.equal(verifyInclusion(i, 13, lh, proof, flipBit(root)), false, "wrong root");
    assert.equal(verifyInclusion(13, 13, lh, proof, root), false, "index past the end");
    assert.equal(verifyInclusion(i, 13, lh, proof.slice(1), root), false, "hash missing");
    // A short proof that stops at an inner node, checked against that node's
    // hash: it rebuilds the "root" correctly but is not a proof for size 13.
    assert.equal(verifyInclusion(i, 13, lh, proof.slice(0, -1), merkleRoot(ls.slice(0, 8))), false, "stops at a subtree");
    assert.equal(verifyInclusion(i, 13, lh, [...proof, proof[0]!], root), false, "extra hash");
    proof.forEach((_, k) => {
      const bad = proof.map((p, j) => (j === k ? flipBit(p) : p));
      assert.equal(verifyInclusion(i, 13, lh, bad, root), false, `proof hash ${k} changed`);
    });
  });
});

describe("merkle: consistency proof", () => {
  it("produces the published proofs", () => {
    for (const v of CONSISTENCY) {
      const proof = consistencyProof(vectorLeaves.slice(0, v.size2), v.size1);
      assert.deepEqual(proof.map(hex), v.proof, `${v.size1} -> ${v.size2}`);
    }
  });

  it("verifies the published proofs", () => {
    for (const v of CONSISTENCY) {
      assert.equal(verifyConsistency(v.size1, v.size2, buf(v.root1), buf(v.root2), v.proof.map(buf)), true);
    }
  });

  it("verifies every older size m <= n up to 40, with at most ceil(log2 n) + 1 hashes", () => {
    for (let n = 1; n <= 40; n++) {
      const ls = leaves(n);
      const root2 = merkleRoot(ls);
      for (let m = 1; m <= n; m++) {
        const proof = consistencyProof(ls, m);
        assert.ok(proof.length <= Math.ceil(Math.log2(n)) + 1, `${m} -> ${n}: ${proof.length} hashes`);
        assert.equal(verifyConsistency(m, n, merkleRoot(ls.slice(0, m)), root2, proof), true, `${m} -> ${n}`);
      }
    }
  });

  it("fails when any old leaf was changed after the old root was published", () => {
    const old = leaves(11);
    const published = merkleRoot(old);
    for (let k = 0; k < 11; k++) {
      const rewritten = [...old, ...leaves(20).slice(11)];
      rewritten[k] = flipBit(rewritten[k]!);
      const proof = consistencyProof(rewritten, 11);
      assert.equal(verifyConsistency(11, 20, published, merkleRoot(rewritten), proof), false, `leaf ${k} changed`);
    }
  });

  it("fails on a changed proof hash, wrong sizes, or a newer tree smaller than the older one", () => {
    const ls = leaves(20);
    const [r1, r2] = [merkleRoot(ls.slice(0, 7)), merkleRoot(ls)];
    const proof = consistencyProof(ls, 7);
    proof.forEach((_, k) => {
      const bad = proof.map((p, j) => (j === k ? flipBit(p) : p));
      assert.equal(verifyConsistency(7, 20, r1, r2, bad), false, `proof hash ${k} changed`);
    });
    assert.equal(verifyConsistency(8, 20, r1, r2, proof), false, "wrong old size");
    // As for inclusion: 17..20 give the same shape for m = 7, so use one that does not.
    assert.equal(verifyConsistency(7, 12, r1, r2, proof), false, "wrong new size");
    assert.equal(verifyConsistency(20, 7, r2, r1, proof), false, "new smaller than old");
    assert.equal(verifyConsistency(7, 20, r1, r2, []), false, "empty proof");
    assert.equal(verifyConsistency(20, 20, r2, r2, []), true, "same tree, empty proof");
    assert.equal(verifyConsistency(20, 20, r2, flipBit(r2), []), false, "same size, different root");
  });
});

describe("merkle: ledger leaves", () => {
  it("are the currentHash bytes of every ledger row, in chainIndex order", async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    const { ledgerLeaves } = await import("../src/lib/ledger.js");
    const rows = await prisma.ledgerEntry.findMany({ orderBy: { chainIndex: "asc" }, select: { currentHash: true } });
    const got = await ledgerLeaves();
    assert.equal(got.length, rows.length);
    got.forEach((leaf, i) => {
      assert.equal(leaf.length, 32);
      assert.equal(hex(leaf), rows[i]!.currentHash);
    });
  });
});
