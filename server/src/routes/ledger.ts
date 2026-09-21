import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../lib/auth";
import { verifyLedger } from "../lib/ledger";
import { GENESIS_HASH } from "../lib/hashChain";

export const ledgerRouter = Router();

ledgerRouter.use(requireAuth);

// ---------------------------------------------------------------------------
// GET /api/ledger
//
// Every record in order. Visible to all three roles on purpose: a record only
// works as proof if the worker it protects can look at it.
// ---------------------------------------------------------------------------
ledgerRouter.get("/", async (req, res) => {
  const workerId = typeof req.query.workerId === "string" ? req.query.workerId : undefined;

  const entries = await prisma.ledgerEntry.findMany({
    where: workerId ? { workerId } : {},
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
// ---------------------------------------------------------------------------
ledgerRouter.post("/verify", async (_req, res) => {
  const result = await verifyLedger();
  return res.json(result);
});
