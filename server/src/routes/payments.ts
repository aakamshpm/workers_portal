import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../lib/auth";
import { appendToChain, computeBalance } from "../lib/ledger";
import {
  generateHandoverCode,
  handoverCodeMessage,
  handoverDoneMessage,
  send,
  shortRef,
  type Language,
} from "../lib/sms";

/**
 * ===========================================================================
 * Payment proof
 * ===========================================================================
 *
 * A separate page and a separate set of routes, because proving a handover is a
 * separate job from recording one.
 *
 * The problem it addresses: cash leaves no trail. A contractor can honestly hand
 * over Rs 10,000 and, if the worker later denies receiving it, nobody can settle
 * the argument. That is not a flaw in the record chain - it is a fact about cash.
 *
 * Two ways to produce a trail, and the contractor chooses per payment:
 *
 *   CODE      - for cash. A one-time code goes to the WORKER's phone; the worker
 *               reads it out once the money is in their hand; the contractor
 *               types it back. Because the code only ever reaches the worker's
 *               phone, the contractor cannot produce it alone.
 *
 *   REFERENCE - for UPI or bank transfer. The transaction id. Strongest of the
 *               three, because the trail exists at the bank, outside this system.
 *
 *   NONE      - recorded with no proof at all. Still allowed, because refusing
 *               would just push contractors off the system entirely. But it is
 *               labelled honestly everywhere it appears.
 *
 * Nothing here is compulsory. A contractor who pays by UPI can ignore this page
 * completely, or use it to attach reference numbers if they want the stronger
 * record. That choice is deliberate: a tool that demands extra work on every
 * payment gets abandoned, and an abandoned tool protects nobody.
 * ===========================================================================
 */
export const paymentsRouter = Router();

paymentsRouter.use(requireAuth);

/** How long a code stays usable. Minutes, because it is meant for the handover itself. */
const CODE_TTL_MINUTES = 15;

const requestSchema = z.object({
  offerId: z.string().min(1, "Choose which work this payment is for"),
  amount: z.coerce.number().positive("How much are you handing over?"),
});

// ---------------------------------------------------------------------------
// POST /api/payments/code
//
// Step 1 of a cash handover: ask for a code.
//
// The code is sent to the worker and deliberately NOT returned in the response.
// If the contractor's own screen showed it, he could complete a handover without
// the worker being present, and the proof would be worthless.
// ---------------------------------------------------------------------------
paymentsRouter.post("/code", requireRole("CONTRACTOR"), async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }

  const { offerId, amount } = parsed.data;

  const offer = await prisma.workOffer.findUnique({
    where: { id: offerId },
    include: { worker: true, contractor: { select: { name: true } } },
  });

  if (!offer) return res.status(404).json({ error: "That work does not exist" });
  if (offer.contractorId !== req.user!.id) {
    return res.status(403).json({ error: "That is not your contract" });
  }
  if (offer.status !== "ACCEPTED") {
    return res.status(409).json({ error: "The worker has not accepted this work yet" });
  }

  // One live code per worker at a time. Without this, two overlapping codes for
  // different amounts could be confused during a handover, and the worker would
  // read out the wrong one.
  await prisma.handoverCode.deleteMany({
    where: { workerId: offer.workerId, usedAt: null },
  });

  const code = generateHandoverCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

  await prisma.handoverCode.create({
    data: {
      offerId,
      workerId: offer.workerId,
      contractorId: req.user!.id,
      amount,
      code,
      expiresAt,
    },
  });

  await send({
    userId: offer.workerId,
    kind: "HANDOVER_CODE",
    language: offer.worker.language,
    body: handoverCodeMessage(
      { amount, contractorName: offer.contractor.name, code },
      offer.worker.language as Language,
    ),
    bodyEn: handoverCodeMessage({ amount, contractorName: offer.contractor.name, code }, "en"),
  });

  return res.status(201).json({
    sent: true,
    workerName: offer.worker.name,
    workerPhone: offer.worker.phone,
    amount,
    expiresAt,
    expiresInMinutes: CODE_TTL_MINUTES,
    // The code itself is NOT returned. Ask the worker.
    message: `A code was sent to ${offer.worker.name} on ${offer.worker.phone}. Hand over the money, then ask them to read the code to you.`,
  });
});

const confirmSchema = z.object({
  offerId: z.string().min(1),
  code: z.string().regex(/^\d{4}$/, "The code is 4 digits"),
  paidOn: z.string().min(1, "Pick the date"),
  note: z.string().max(300).optional(),
});

// ---------------------------------------------------------------------------
// POST /api/payments/confirm-code
//
// Step 2: the contractor types in the code the worker read out.
//
// On success the payment is recorded with proofType CODE and marked as confirmed
// by the worker in the same breath - the worker giving the code IS the
// confirmation, so asking them to reply OK afterwards would be asking twice for
// the same thing.
// ---------------------------------------------------------------------------
paymentsRouter.post("/confirm-code", requireRole("CONTRACTOR"), async (req, res) => {
  const parsed = confirmSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }

  const { offerId, code, note } = parsed.data;

  const offer = await prisma.workOffer.findUnique({
    where: { id: offerId },
    include: { worker: true, contractor: { select: { name: true } } },
  });
  if (!offer) return res.status(404).json({ error: "That work does not exist" });
  if (offer.contractorId !== req.user!.id) {
    return res.status(403).json({ error: "That is not your contract" });
  }

  const record = await prisma.handoverCode.findFirst({
    where: { offerId, contractorId: req.user!.id, code, usedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (!record) {
    return res.status(404).json({
      error: "That code is wrong, or it has already been used. Ask the worker to read it again.",
    });
  }
  if (record.expiresAt < new Date()) {
    return res.status(409).json({
      error: "That code has expired. Send a new one and try again.",
    });
  }

  const paidOn = new Date(parsed.data.paidOn);
  if (Number.isNaN(paidOn.getTime())) {
    return res.status(400).json({ error: "That date is not valid" });
  }

  const confirmedAt = new Date();
  const amount = record.amount;

  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        offerId,
        amount,
        paidOn,
        method: "CASH",
        note: note?.trim() || null,
        proofType: "CODE",
        proofAt: confirmedAt,
        // The code IS the worker's confirmation, so the payment is confirmed
        // the moment it is created.
        confirmState: "CONFIRMED",
        confirmedAt,
        confirmedVia: "CODE",
      },
    });

    await tx.handoverCode.update({
      where: { id: record.id },
      data: { usedAt: confirmedAt, paymentId: payment.id },
    });

    const link = await appendToChain(tx, {
      recordType: "PAYMENT",
      recordId: payment.id,
      workerId: offer.workerId,
      summary: `Paid Rs ${amount.toFixed(2)} cash to ${offer.worker.name}, confirmed by handover code`,
      payload: {
        type: "PAYMENT",
        offerId,
        workerId: offer.workerId,
        amount,
        paidOn: paidOn.toISOString(),
        method: "CASH",
        note: note?.trim() ?? "",
      },
    });

    // The worker's agreement, sealed as its own record exactly as an OK reply
    // would be. The evidence is the same shape however it arrived.
    const confirmLink = await appendToChain(tx, {
      recordType: "CONFIRM",
      recordId: `PAYMENT:${payment.id}`,
      workerId: offer.workerId,
      summary: `${offer.worker.name} confirmed receiving Rs ${amount.toFixed(0)} by reading out the handover code`,
      payload: {
        type: "CONFIRM",
        targetType: "PAYMENT",
        targetId: payment.id,
        workerId: offer.workerId,
        value: amount,
        confirmedAt: confirmedAt.toISOString(),
        via: "CODE",
      },
    });

    return { payment, link, confirmLink };
  });

  const ref = shortRef(result.confirmLink.currentHash);

  await send({
    userId: offer.workerId,
    kind: "HANDOVER_DONE",
    reference: ref,
    language: offer.worker.language,
    body: handoverDoneMessage(
      { amount, contractorName: offer.contractor.name, ref },
      offer.worker.language as Language,
    ),
    bodyEn: handoverDoneMessage(
      { amount, contractorName: offer.contractor.name, ref },
      "en",
    ),
  });

  const balance = await computeBalance(offerId);

  return res.status(201).json({
    recorded: true,
    proofType: "CODE",
    amount,
    workerName: offer.worker.name,
    ref,
    balance,
    message: `Rs ${amount.toFixed(0)} recorded with proof of handover. ${offer.worker.name} has the receipt on their phone.`,
  });
});

const referenceSchema = z.object({
  offerId: z.string().min(1),
  amount: z.coerce.number().positive("How much was transferred?"),
  paidOn: z.string().min(1, "Pick the date"),
  method: z.enum(["UPI", "BANK"]),
  reference: z.string().min(4, "Enter the transaction reference").max(80),
  note: z.string().max(300).optional(),
});

// ---------------------------------------------------------------------------
// POST /api/payments/reference
//
// Record a UPI or bank transfer with its transaction id.
//
// No code is needed here, and asking for one would be pointless: the bank
// already holds a trail that neither party controls, which is stronger evidence
// than anything this system can produce. The reference is stored so an officer
// can check it against the bank if the payment is ever questioned.
//
// The payment is still sent to the worker for confirmation, because a reference
// number proves a transfer happened - not that it reached the right person for
// the right work.
// ---------------------------------------------------------------------------
paymentsRouter.post("/reference", requireRole("CONTRACTOR"), async (req, res) => {
  const parsed = referenceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }

  const { offerId, amount, method, reference, note } = parsed.data;

  const offer = await prisma.workOffer.findUnique({
    where: { id: offerId },
    include: { worker: true, contractor: { select: { name: true } } },
  });
  if (!offer) return res.status(404).json({ error: "That work does not exist" });
  if (offer.contractorId !== req.user!.id) {
    return res.status(403).json({ error: "That is not your contract" });
  }
  if (offer.status !== "ACCEPTED") {
    return res.status(409).json({ error: "The worker has not accepted this work yet" });
  }

  const paidOn = new Date(parsed.data.paidOn);
  if (Number.isNaN(paidOn.getTime())) {
    return res.status(400).json({ error: "That date is not valid" });
  }

  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        offerId,
        amount,
        paidOn,
        method,
        note: note?.trim() || null,
        proofType: "REFERENCE",
        proofReference: reference.trim(),
        proofAt: new Date(),
      },
    });

    const link = await appendToChain(tx, {
      recordType: "PAYMENT",
      recordId: payment.id,
      workerId: offer.workerId,
      summary: `Paid Rs ${amount.toFixed(2)} to ${offer.worker.name} by ${method} (ref ${reference.trim()})`,
      payload: {
        type: "PAYMENT",
        offerId,
        workerId: offer.workerId,
        amount,
        paidOn: paidOn.toISOString(),
        method,
        note: note?.trim() ?? "",
      },
    });

    return { payment, link };
  });

  const ref = shortRef(result.link.currentHash);

  const { confirmPaymentMessage } = await import("../lib/sms");
  const payText = {
    amount,
    paidOn: paidOn.toISOString().slice(0, 10),
    contractorName: offer.contractor.name,
    ref,
  };

  await send({
    userId: offer.workerId,
    kind: "CONFIRM_PAYMENT",
    reference: ref,
    language: offer.worker.language,
    body: confirmPaymentMessage(payText, offer.worker.language as Language),
    bodyEn: confirmPaymentMessage(payText, "en"),
  });

  const balance = await computeBalance(offerId);

  return res.status(201).json({
    recorded: true,
    proofType: "REFERENCE",
    amount,
    reference: reference.trim(),
    ref,
    balance,
  });
});

// ---------------------------------------------------------------------------
// GET /api/payments/pending-code
//
// Any code the contractor is currently waiting on, so the page survives a
// refresh mid-handover. The code value is never included.
// ---------------------------------------------------------------------------
paymentsRouter.get("/pending-code", requireRole("CONTRACTOR"), async (req, res) => {
  const record = await prisma.handoverCode.findFirst({
    where: { contractorId: req.user!.id, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { offerId: true, amount: true, expiresAt: true, workerId: true },
  });

  if (!record) return res.json(null);

  const worker = await prisma.user.findUnique({
    where: { id: record.workerId },
    select: { name: true, phone: true },
  });

  return res.json({ ...record, worker });
});

// ---------------------------------------------------------------------------
// GET /api/payments/history?offerId=
//
// Every payment on a contract with its proof level, for the contractor's page
// and the officer's review.
// ---------------------------------------------------------------------------
paymentsRouter.get("/history", async (req, res) => {
  const user = req.user!;
  const offerId = typeof req.query.offerId === "string" ? req.query.offerId : undefined;

  const scope =
    user.role === "WORKER"
      ? { offer: { workerId: user.id } }
      : user.role === "CONTRACTOR"
        ? { offer: { contractorId: user.id } }
        : {};

  const payments = await prisma.payment.findMany({
    where: offerId ? { ...scope, offerId } : scope,
    orderBy: { paidOn: "desc" },
    include: {
      offer: {
        select: {
          id: true,
          siteName: true,
          worker: { select: { id: true, name: true, phone: true } },
          contractor: { select: { id: true, name: true } },
        },
      },
    },
  });

  return res.json(
    payments.map((p) => ({
      id: p.id,
      offerId: p.offerId,
      siteName: p.offer.siteName,
      worker: p.offer.worker,
      contractor: p.offer.contractor,
      amount: p.amount,
      paidOn: p.paidOn,
      method: p.method,
      note: p.note,
      confirmState: p.confirmState,
      confirmedVia: p.confirmedVia,
      workerClaimsAmount: p.workerClaimsAmount,
      disputeNote: p.disputeNote,
      proofType: p.proofType,
      proofReference: p.proofReference,
      proofAt: p.proofAt,
      /**
       * How strong the evidence is, in one word, so the interface does not have
       * to work it out in three places.
       *
       *   strong   - a bank or UPI trail exists outside this system
       *   good     - the worker's code was read back at handover
       *   weak     - the worker confirmed later, from memory
       *   none     - only the contractor's word
       *   disputed - the worker says it did not happen
       */
      evidence:
        p.confirmState === "DISPUTED"
          ? "disputed"
          : p.proofType === "REFERENCE"
            ? "strong"
            : p.proofType === "CODE"
              ? "good"
              : p.confirmState === "CONFIRMED"
                ? "weak"
                : "none",
    })),
  );
});
