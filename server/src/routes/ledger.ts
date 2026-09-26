import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../lib/auth";
import { verifyLedger } from "../lib/ledger";
import { GENESIS_HASH } from "../lib/hashChain";
import { visibleEntries } from "../lib/visibility";

export const ledgerRouter = Router();

ledgerRouter.use(requireAuth);

// ---------------------------------------------------------------------------
// GET /api/ledger
//
// The records the caller may see, in order. Contract: docs/contracts/ledger.md.
//
// A worker sees his own contracts, a contractor his own contracts, and the
// labour officer everything (ADR-0013). A record only works as proof if the
// worker it protects can look at it, and it only stays private if nobody else
// can.
//
// Only the officer may narrow the list with ?workerId=. For anyone else it is
// ignored, so changing the address cannot open another worker's records.
// ---------------------------------------------------------------------------
ledgerRouter.get("/", async (req, res) => {
  const user = req.user!;
  const visible = await visibleEntries(user);

  const workerId =
    user.role === "AUTHORITY" && typeof req.query.workerId === "string" ? req.query.workerId : undefined;

  const entries = await prisma.ledgerEntry.findMany({
    where: { ...(visible ?? {}), ...(workerId ? { workerId } : {}) },
    orderBy: { chainIndex: "asc" },
    select: {
      id: true,
      chainIndex: true,
      recordType: true,
      recordId: true,
      workerId: true,
      summary: true,
      createdAt: true,
      previousHash: true,
      currentHash: true,
    },
  });

  return res.json({ genesisHash: GENESIS_HASH, entries });
});

// ---------------------------------------------------------------------------
// POST /api/ledger/verify
//
// Rebuild every record's code from the live database and compare. POST rather
// than GET because it is an explicit action, and so nothing caches the answer.
//
// The check always covers the whole chain, because one changed record breaks
// every record after it, and a partial check could call a broken chain valid.
// It returns the details only of problems in records the caller may see, and
// a count of the rest, so a contractor learns that something is wrong without
// being shown another contractor's figures.
// ---------------------------------------------------------------------------
ledgerRouter.post("/verify", async (req, res) => {
  const result = await verifyLedger();
  const visible = await visibleEntries(req.user!);

  if (visible === null) return res.json({ ...result, hiddenFailures: 0 });

  const mine = await prisma.ledgerEntry.findMany({ where: visible, select: { id: true } });
  const ids = new Set(mine.map((e) => e.id));
  const failures = result.failures.filter((f) => ids.has(f.entryId));

  return res.json({
    ...result,
    failures,
    hiddenFailures: result.failures.length - failures.length,
  });
});
