import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../lib/auth";
import {
  allBalances,
  appendToChain,
  balancesForContractor,
  balancesForWorker,
  computeBalance,
} from "../lib/ledger";
import {
  acceptedMessage,
  confirmPaymentMessage,
  confirmWorkMessage,
  declinedMessage,
  offerMessage,
  send,
  shortRef,
  type Language,
} from "../lib/sms";
import { respondToRecord } from "../lib/confirmations";

export const offersRouter = Router();

offersRouter.use(requireAuth);

const offerSelect = {
  id: true,
  status: true,
  dailyRate: true,
  workType: true,
  siteName: true,
  startDate: true,
  expectedDays: true,
  extraTerms: true,
  createdAt: true,
  respondedAt: true,
  respondedVia: true,
  declineReason: true,
  worker: { select: { id: true, name: true, phone: true, homeState: true, language: true } },
  contractor: { select: { id: true, name: true, phone: true, company: true } },
} as const;

// ---------------------------------------------------------------------------
// GET /api/offers
//
// Offers, filtered by who is asking. The filter comes from the token, never from
// a query parameter, so a worker cannot read another worker's offers by changing
// the URL.
//
// ?status=PENDING narrows it to what needs a reply.
// ---------------------------------------------------------------------------
offersRouter.get("/", async (req, res) => {
  const user = req.user!;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;

  const scope =
    user.role === "WORKER"
      ? { workerId: user.id }
      : user.role === "CONTRACTOR"
        ? { contractorId: user.id }
        : {};

  const offers = await prisma.workOffer.findMany({
    where: status ? { ...scope, status } : scope,
    orderBy: { createdAt: "desc" },
    select: offerSelect,
  });

  // Each offer carries its reply code, so the dashboard and the SMS page show the
  // same code for the same offer.
  const withRef = await Promise.all(
    offers.map(async (o) => {
      const link = await prisma.ledgerEntry.findFirst({
        where: { recordType: "OFFER", recordId: o.id },
        select: { currentHash: true },
      });
      return { ...o, ref: link ? shortRef(link.currentHash) : null };
    }),
  );

  return res.json(withRef);
});

// ---------------------------------------------------------------------------
// GET /api/offers/balances
// Accepted contracts with the money worked out. This is the main dashboard feed.
// ---------------------------------------------------------------------------
offersRouter.get("/balances", async (req, res) => {
  const user = req.user!;

  const balances =
    user.role === "WORKER"
      ? await balancesForWorker(user.id)
      : user.role === "CONTRACTOR"
        ? await balancesForContractor(user.id)
        : await allBalances();

  return res.json(balances);
});

// ---------------------------------------------------------------------------
// GET /api/offers/workers?phone=98800
//
// Find a worker to send an offer to. A contractor knows the worker's phone number
// - that is how they met - so lookup is by number rather than by browsing a list
// of every worker in the state.
// ---------------------------------------------------------------------------
offersRouter.get("/workers", requireRole("CONTRACTOR", "AUTHORITY"), async (req, res) => {
  const search = typeof req.query.phone === "string" ? req.query.phone.replace(/\D/g, "") : "";

  const workers = await prisma.user.findMany({
    where: {
      role: "WORKER",
      ...(search ? { phone: { contains: search } } : {}),
    },
    select: { id: true, name: true, phone: true, homeState: true, language: true },
    orderBy: { name: "asc" },
    take: 20,
  });

  return res.json(workers);
});

const createOfferSchema = z.object({
  workerPhone: z.string().min(6, "Enter the worker's phone number"),
  dailyRate: z.coerce.number().positive("Daily rate must be more than zero"),
  workType: z.string().min(2, "Say what the work is").max(120),
  siteName: z.string().min(2, "Say where the site is").max(120),
  startDate: z.string().min(1, "Pick a start date"),
  expectedDays: z.coerce.number().int().positive("How many days do you expect?"),
  extraTerms: z.string().max(500).optional(),
});

// ---------------------------------------------------------------------------
// POST /api/offers
//
// The contractor sends a formal offer for terms already agreed verbally.
//
// The offer is sealed into the record chain immediately, before the worker has
// replied. That is deliberate: it means the contractor cannot quietly change the
// figures while waiting for an answer, so what the worker says yes to is exactly
// what was sent.
// ---------------------------------------------------------------------------
offersRouter.post("/", requireRole("CONTRACTOR"), async (req, res) => {
  const parsed = createOfferSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }

  const { dailyRate, workType, siteName, startDate, expectedDays, extraTerms } = parsed.data;
  const phone = parsed.data.workerPhone.replace(/\D/g, "").slice(-10);

  const worker = await prisma.user.findUnique({ where: { phone } });
  if (!worker || worker.role !== "WORKER") {
    return res.status(404).json({
      error: "No worker registered with that number. Ask them to register on the worker site first.",
    });
  }

  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) {
    return res.status(400).json({ error: "That start date is not valid" });
  }

  const contractor = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { name: true, company: true },
  });

  const result = await prisma.$transaction(async (tx) => {
    const offer = await tx.workOffer.create({
      data: {
        workerId: worker.id,
        contractorId: req.user!.id,
        dailyRate,
        workType: workType.trim(),
        siteName: siteName.trim(),
        startDate: start,
        expectedDays,
        extraTerms: extraTerms?.trim() || null,
        status: "PENDING",
      },
      select: offerSelect,
    });

    const link = await appendToChain(tx, {
      recordType: "OFFER",
      recordId: offer.id,
      workerId: worker.id,
      summary: `Offer sent: Rs ${dailyRate.toFixed(2)}/day, ${workType}, ${siteName}`,
      payload: {
        type: "OFFER",
        workerId: worker.id,
        contractorId: req.user!.id,
        dailyRate,
        workType: workType.trim(),
        siteName: siteName.trim(),
        startDate: start.toISOString(),
        expectedDays,
        extraTerms: extraTerms?.trim() ?? "",
      },
    });

    return { offer, link };
  });

  // The SMS goes out immediately, so the worker's phone has the terms before any
  // work starts.
  const ref = shortRef(result.link.currentHash);
  // Built once, then rendered twice: in the worker's language for him, and in
  // English so anyone reviewing the message can read what he was told.
  const offerText = {
    workerName: worker.name,
    contractorName: contractor!.name,
    company: contractor!.company,
    dailyRate,
    workType,
    siteName,
    expectedDays,
    ref,
  };
  await send({
    userId: worker.id,
    kind: "OFFER",
    reference: ref,
    language: worker.language,
    body: offerMessage(offerText, worker.language as Language),
    bodyEn: offerMessage(offerText, "en"),
  });

  return res.status(201).json({ ...result.offer, ref });
});

const respondSchema = z.object({
  decision: z.enum(["ACCEPT", "DECLINE"]),
  reason: z.string().max(300).optional(),
});

// ---------------------------------------------------------------------------
// PATCH /api/offers/:id/respond
//
// The worker accepts or refuses, from the website. The SMS route does the same
// thing through /api/sms/reply.
//
// On acceptance a second record is sealed: the worker's own YES, against the exact
// figures. From that moment the terms are locked - there is no route anywhere in
// this API that can change the rate on an accepted offer.
// ---------------------------------------------------------------------------
offersRouter.patch("/:id/respond", requireRole("WORKER"), async (req, res) => {
  const parsed = respondSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Say whether you accept or refuse" });
  }

  const id = String(req.params.id);
  const worker = req.user!;

  const offer = await prisma.workOffer.findUnique({ where: { id } });
  if (!offer) {
    return res.status(404).json({ error: "That offer does not exist" });
  }
  if (offer.workerId !== worker.id) {
    return res.status(403).json({ error: "That offer was not sent to you" });
  }
  if (offer.status !== "PENDING") {
    return res.status(409).json({
      error: `You already replied to this offer — it is marked ${offer.status.toLowerCase()}.`,
    });
  }

  const result = await respondToOffer({
    offerId: id,
    decision: parsed.data.decision,
    via: "WEB",
    reason: parsed.data.reason,
  });

  return res.json(result);
});

/**
 * Shared by the website route above and the SMS reply route.
 *
 * Kept in one function on purpose: if accepting by SMS and accepting on the
 * website took different code paths, they could drift and one of them could
 * eventually fail to seal the acceptance. The worker's YES must mean exactly the
 * same thing however it arrives.
 */
export async function respondToOffer(input: {
  offerId: string;
  decision: "ACCEPT" | "DECLINE";
  via: "WEB" | "SMS";
  reason?: string;
}) {
  const offer = await prisma.workOffer.findUnique({
    where: { id: input.offerId },
    include: { worker: true },
  });
  if (!offer) throw new Error("Offer not found");

  const respondedAt = new Date();

  if (input.decision === "DECLINE") {
    const updated = await prisma.workOffer.update({
      where: { id: offer.id },
      data: {
        status: "DECLINED",
        respondedAt,
        respondedVia: input.via,
        declineReason: input.reason?.trim() || null,
      },
    });

    const link = await prisma.ledgerEntry.findFirst({
      where: { recordType: "OFFER", recordId: offer.id },
      select: { currentHash: true },
    });
    const ref = link ? shortRef(link.currentHash) : "0000";

    await send({
      userId: offer.workerId,
      kind: "DECLINED",
      reference: ref,
      language: offer.worker.language,
      body: declinedMessage({ siteName: offer.siteName, ref }, offer.worker.language as Language),
      bodyEn: declinedMessage({ siteName: offer.siteName, ref }, "en"),
    });

    return { offer: updated, accepted: false, ref };
  }

  // Accepting seals the worker's agreement as its own record.
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.workOffer.update({
      where: { id: offer.id },
      data: { status: "ACCEPTED", respondedAt, respondedVia: input.via },
    });

    const link = await appendToChain(tx, {
      recordType: "ACCEPT",
      // The offer's id, because there is exactly one acceptance per offer.
      recordId: offer.id,
      workerId: offer.workerId,
      summary: `${offer.worker.name} accepted Rs ${offer.dailyRate.toFixed(2)}/day at ${offer.siteName} (by ${input.via === "SMS" ? "SMS" : "website"})`,
      payload: {
        type: "ACCEPT",
        offerId: offer.id,
        workerId: offer.workerId,
        dailyRate: offer.dailyRate,
        workType: offer.workType,
        siteName: offer.siteName,
        acceptedAt: respondedAt.toISOString(),
        via: input.via,
      },
    });

    return { updated, link };
  });

  const ref = shortRef(result.link.currentHash);

  await send({
    userId: offer.workerId,
    kind: "ACCEPTED",
    reference: ref,
    language: offer.worker.language,
    body: acceptedMessage(
      { dailyRate: offer.dailyRate, siteName: offer.siteName, ref },
      offer.worker.language as Language,
    ),
    bodyEn: acceptedMessage(
      { dailyRate: offer.dailyRate, siteName: offer.siteName, ref },
      "en",
    ),
  });

  return { offer: result.updated, accepted: true, ref };
}

const workSchema = z.object({
  offerId: z.string().min(1),
  fromDate: z.string().min(1, "Pick a start date"),
  toDate: z.string().min(1, "Pick an end date"),
  days: z.coerce.number().positive("How many days were worked?").max(31),
  note: z.string().max(300).optional(),
});

// ---------------------------------------------------------------------------
// POST /api/offers/work
//
// Log a stretch of work against an accepted contract.
//
// Recorded a period at a time rather than one row per day, because a contractor
// pays weekly and thinks in weeks. The number that matters is the day count, and
// it is sealed either way.
// ---------------------------------------------------------------------------
offersRouter.post("/work", requireRole("CONTRACTOR"), async (req, res) => {
  const parsed = workSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }

  const { offerId, days, note } = parsed.data;
  const offer = await prisma.workOffer.findUnique({
    where: { id: offerId },
    include: { worker: { select: { id: true, name: true, language: true } } },
  });

  if (!offer) return res.status(404).json({ error: "That contract does not exist" });
  if (offer.contractorId !== req.user!.id) {
    return res.status(403).json({ error: "That is not your contract" });
  }
  // Work can only be logged against terms the worker has agreed to. This is the
  // rule that makes acceptance meaningful rather than decorative.
  if (offer.status !== "ACCEPTED") {
    return res.status(409).json({
      error: `You cannot log work yet — the worker has not accepted this offer (it is ${offer.status.toLowerCase()}).`,
    });
  }

  const from = new Date(parsed.data.fromDate);
  const to = new Date(parsed.data.toDate);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return res.status(400).json({ error: "Those dates are not valid" });
  }
  if (to < from) {
    return res.status(400).json({ error: "The end date is before the start date" });
  }

  const result = await prisma.$transaction(async (tx) => {
    const period = await tx.workPeriod.create({
      data: { offerId, fromDate: from, toDate: to, days, note: note?.trim() || null },
    });

    const link = await appendToChain(tx, {
      recordType: "WORK",
      recordId: period.id,
      workerId: offer.workerId,
      summary: `${offer.worker.name} worked ${days} day${days === 1 ? "" : "s"} (${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)})`,
      payload: {
        type: "WORK",
        offerId,
        workerId: offer.workerId,
        fromDate: from.toISOString(),
        toDate: to.toISOString(),
        days,
        note: note?.trim() ?? "",
      },
    });

    return { period, link };
  });

  // Ask the worker to confirm, immediately.
  //
  // This is the whole point of the confirmation design: the contractor writes
  // the number, and the worker is asked the same day whether it is true. Sending
  // it later, or only on request, would let an understated week pass unnoticed.
  const ref = shortRef(result.link.currentHash);
  const contractor = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { name: true },
  });

  const workText = {
    days,
    fromDate: from.toISOString().slice(0, 10),
    toDate: to.toISOString().slice(0, 10),
    contractorName: contractor!.name,
    ref,
  };

  await send({
    userId: offer.workerId,
    kind: "CONFIRM_WORK",
    reference: ref,
    language: offer.worker.language,
    body: confirmWorkMessage(workText, offer.worker.language as Language),
    bodyEn: confirmWorkMessage(workText, "en"),
  });

  return res.status(201).json({ ...result, ref });
});

const paymentSchema = z.object({
  offerId: z.string().min(1),
  amount: z.coerce.number().positive("How much was paid?"),
  paidOn: z.string().min(1, "Pick the date it was paid"),
  method: z.enum(["CASH", "UPI", "BANK"]).default("CASH"),
  note: z.string().max(300).optional(),
});

// ---------------------------------------------------------------------------
// POST /api/offers/payment
// Record money handed over, and text the worker so a short payment is visible
// the same day rather than months later.
// ---------------------------------------------------------------------------
offersRouter.post("/payment", requireRole("CONTRACTOR"), async (req, res) => {
  const parsed = paymentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }

  const { offerId, amount, method, note } = parsed.data;
  const offer = await prisma.workOffer.findUnique({
    where: { id: offerId },
    include: { worker: true },
  });

  if (!offer) return res.status(404).json({ error: "That contract does not exist" });
  if (offer.contractorId !== req.user!.id) {
    return res.status(403).json({ error: "That is not your contract" });
  }
  if (offer.status !== "ACCEPTED") {
    return res.status(409).json({ error: "The worker has not accepted this offer yet" });
  }

  const paidOn = new Date(parsed.data.paidOn);
  if (Number.isNaN(paidOn.getTime())) {
    return res.status(400).json({ error: "That payment date is not valid" });
  }

  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: { offerId, amount, paidOn, method, note: note?.trim() || null },
    });

    const link = await appendToChain(tx, {
      recordType: "PAYMENT",
      recordId: payment.id,
      workerId: offer.workerId,
      summary: `Paid Rs ${amount.toFixed(2)} to ${offer.worker.name} by ${method}`,
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

  const balance = await computeBalance(offerId);
  const ref = shortRef(result.link.currentHash);

  const contractor = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { name: true },
  });

  // Ask the worker to confirm they received it, rather than just telling them it
  // was paid. A cash payment leaves no bank trail, so the worker's OK is the only
  // receipt that exists - and a payment the worker never got is exactly the thing
  // a one-sided record would hide.
  const payText = {
    amount,
    paidOn: paidOn.toISOString().slice(0, 10),
    contractorName: contractor!.name,
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

  return res.status(201).json({ ...result, balance, ref });
});

// ---------------------------------------------------------------------------
// GET /api/offers/awaiting
//
// Work and payment records waiting for the worker's answer, oldest first.
//
// This is the worker's to-do list, and the reason the confirmation design holds:
// nothing needs the worker to remember a code or go looking. Everything unanswered
// is on one screen.
// ---------------------------------------------------------------------------
offersRouter.get("/awaiting", requireRole("WORKER"), async (req, res) => {
  const workerId = req.user!.id;

  const periods = await prisma.workPeriod.findMany({
    where: { confirmState: "WAITING", offer: { workerId } },
    orderBy: { createdAt: "asc" },
    include: {
      offer: {
        select: {
          id: true,
          dailyRate: true,
          siteName: true,
          contractor: { select: { name: true, company: true } },
        },
      },
    },
  });

  const payments = await prisma.payment.findMany({
    where: { confirmState: "WAITING", offer: { workerId } },
    orderBy: { createdAt: "asc" },
    include: {
      offer: {
        select: {
          id: true,
          siteName: true,
          contractor: { select: { name: true, company: true } },
        },
      },
    },
  });

  async function refFor(recordType: string, recordId: string) {
    const link = await prisma.ledgerEntry.findFirst({
      where: { recordType, recordId },
      select: { currentHash: true },
    });
    return link ? shortRef(link.currentHash) : null;
  }

  const items = [
    ...(await Promise.all(
      periods.map(async (p) => ({
        kind: "WORK" as const,
        id: p.id,
        offerId: p.offer.id,
        siteName: p.offer.siteName,
        contractorName: p.offer.contractor.name,
        company: p.offer.contractor.company,
        days: p.days,
        fromDate: p.fromDate,
        toDate: p.toDate,
        note: p.note,
        worth: p.days * p.offer.dailyRate,
        recordedAt: p.createdAt,
        ref: await refFor("WORK", p.id),
      })),
    )),
    ...(await Promise.all(
      payments.map(async (p) => ({
        kind: "PAYMENT" as const,
        id: p.id,
        offerId: p.offer.id,
        siteName: p.offer.siteName,
        contractorName: p.offer.contractor.name,
        company: p.offer.contractor.company,
        amount: p.amount,
        paidOn: p.paidOn,
        method: p.method,
        note: p.note,
        recordedAt: p.createdAt,
        ref: await refFor("PAYMENT", p.id),
      })),
    )),
  ].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());

  return res.json(items);
});

const confirmSchema = z.object({
  kind: z.enum(["WORK", "PAYMENT"]),
  id: z.string().min(1),
  decision: z.enum(["CONFIRM", "REJECT"]),
  workerValue: z.coerce.number().min(0).optional(),
  note: z.string().max(500).optional(),
});

// ---------------------------------------------------------------------------
// POST /api/offers/confirm
//
// The worker answers a work or payment record from the website. The SMS route
// does the same thing through /api/sms/reply, and both call the same function so
// the two channels cannot drift apart.
// ---------------------------------------------------------------------------
offersRouter.post("/confirm", requireRole("WORKER"), async (req, res) => {
  const parsed = confirmSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }

  const { kind, id, decision, workerValue, note } = parsed.data;

  if (decision === "REJECT" && workerValue === undefined) {
    return res.status(400).json({
      error:
        kind === "WORK"
          ? "Say how many days you actually worked"
          : "Say how much you actually received",
    });
  }

  const result = await respondToRecord({
    workerId: req.user!.id,
    targetType: kind,
    targetId: id,
    decision,
    via: "WEB",
    workerValue,
    note,
  });

  if (!result.ok) {
    return res.status(409).json({ error: result.error });
  }

  return res.json(result);
});

// ---------------------------------------------------------------------------
// GET /api/offers/disagreements
//
// Every record on your own contracts that the worker rejected, whichever side of
// it you are.
//
// One route for both roles rather than two, because the facts are identical and
// only the wording differs: the same two figures, the same employer statement,
// the same officer review. Splitting it would let the worker's view and the
// contractor's view drift apart, and a disagreement where the two parties are
// shown different things is exactly what this project exists to prevent.
//
// Field names are neutral for the same reason. The client says "you" and "he"
// according to who is reading.
// ---------------------------------------------------------------------------
offersRouter.get("/disagreements", requireRole("WORKER", "CONTRACTOR"), async (req, res) => {
  const user = req.user!;
  const scope =
    user.role === "WORKER" ? { offer: { workerId: user.id } } : { offer: { contractorId: user.id } };

  const periods = await prisma.workPeriod.findMany({
    where: { confirmState: "DISPUTED", ...scope },
    orderBy: { confirmedAt: "desc" },
    include: {
      offer: {
        select: {
          id: true,
          dailyRate: true,
          siteName: true,
          worker: { select: { id: true, name: true, phone: true } },
          contractor: { select: { id: true, name: true, phone: true, company: true } },
        },
      },
    },
  });

  const payments = await prisma.payment.findMany({
    where: { confirmState: "DISPUTED", ...scope },
    orderBy: { confirmedAt: "desc" },
    include: {
      offer: {
        select: {
          id: true,
          siteName: true,
          worker: { select: { id: true, name: true, phone: true } },
          contractor: { select: { id: true, name: true, phone: true, company: true } },
        },
      },
    },
  });

  const offerIds = [...new Set([...periods, ...payments].map((r) => r.offerId))];

  const statements = await prisma.employerStatement.findMany({
    where: { offerId: { in: offerIds } },
    select: { targetType: true, targetId: true, note: true, createdAt: true },
  });
  const said = new Map(statements.map((x) => [`${x.targetType}:${x.targetId}`, x]));

  // The officer's review, so both parties learn that the labour office has
  // looked. Without this the worker's screen shows an open disagreement for ever
  // and he has no way to know anything happened.
  const reviews = await prisma.disputeReview.findMany({
    where: { offerId: { in: offerIds } },
    include: { officer: { select: { id: true, name: true } } },
  });
  const reviewed = new Map(reviews.map((r) => [`${r.targetType}:${r.targetId}`, r]));

  const employerStatement = (kind: string, id: string) => {
    const x = said.get(`${kind}:${id}`);
    return x ? { note: x.note, at: x.createdAt } : null;
  };

  const review = (kind: string, id: string) => {
    const r = reviewed.get(`${kind}:${id}`);
    return r ? { reason: r.reason, note: r.note, at: r.createdAt, officer: r.officer } : null;
  };

  const items = [
    ...periods.map((w) => ({
      kind: "WORK" as const,
      id: w.id,
      offerId: w.offerId,
      siteName: w.offer.siteName,
      worker: w.offer.worker,
      contractor: w.offer.contractor,
      period: `${w.fromDate.toISOString().slice(0, 10)} to ${w.toDate.toISOString().slice(0, 10)}`,
      contractorSays: `${w.days} day${w.days === 1 ? "" : "s"}`,
      workerSays:
        w.workerClaimsDays === null
          ? "no figure given"
          : `${w.workerClaimsDays} day${w.workerClaimsDays === 1 ? "" : "s"}`,
      gapValue:
        w.workerClaimsDays === null
          ? null
          : Math.abs(w.days - w.workerClaimsDays) * w.offer.dailyRate,
      workerNote: w.disputeNote,
      at: w.confirmedAt,
      via: w.confirmedVia,
      employerStatement: employerStatement("WORK", w.id),
      review: review("WORK", w.id),
    })),
    ...payments.map((p) => ({
      kind: "PAYMENT" as const,
      id: p.id,
      offerId: p.offerId,
      siteName: p.offer.siteName,
      worker: p.offer.worker,
      contractor: p.offer.contractor,
      period: p.paidOn.toISOString().slice(0, 10),
      contractorSays: `Rs ${p.amount.toFixed(0)} by ${p.method}`,
      workerSays:
        p.workerClaimsAmount === null ? "no figure given" : `Rs ${p.workerClaimsAmount.toFixed(0)}`,
      gapValue:
        p.workerClaimsAmount === null ? p.amount : Math.abs(p.amount - p.workerClaimsAmount),
      workerNote: p.disputeNote,
      at: p.confirmedAt,
      via: p.confirmedVia,
      employerStatement: employerStatement("PAYMENT", p.id),
      review: review("PAYMENT", p.id),
    })),
  ].sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));

  return res.json(items);
});

const statementSchema = z.object({
  kind: z.enum(["WORK", "PAYMENT"]),
  id: z.string().min(1),
  note: z
    .string()
    .min(10, "Explain in a little more detail what happened")
    .max(1000),
});

// ---------------------------------------------------------------------------
// POST /api/offers/statement
//
// The contractor states his side of a record the worker rejected.
//
// What this route deliberately does NOT do:
//
//   - It does not change the WorkPeriod or the Payment. The figures both people
//     gave stay exactly as they were sealed.
//   - It does not clear `confirmState`. The record stays DISPUTED, and only the
//     worker or the officer can end that.
//   - It does not create a Complaint. Whether the disagreement becomes a case is
//     the officer's decision, not the employer's.
//
// What it does is put his account on the file, sealed, so the officer reads two
// statements instead of one plus silence.
// ---------------------------------------------------------------------------
offersRouter.post("/statement", requireRole("CONTRACTOR"), async (req, res) => {
  const parsed = statementSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }

  const { kind, id, note } = parsed.data;

  // Load the record and its contract together, so ownership and dispute state are
  // both checked before anything is written.
  const target =
    kind === "WORK"
      ? await prisma.workPeriod.findUnique({
          where: { id },
          select: {
            offerId: true,
            confirmState: true,
            offer: { select: { contractorId: true, worker: { select: { name: true } } } },
          },
        })
      : await prisma.payment.findUnique({
          where: { id },
          select: {
            offerId: true,
            confirmState: true,
            offer: { select: { contractorId: true, worker: { select: { name: true } } } },
          },
        });

  if (!target) return res.status(404).json({ error: "That record does not exist" });
  if (target.offer.contractorId !== req.user!.id) {
    return res.status(403).json({ error: "That record is not on your contract" });
  }
  if (target.confirmState !== "DISPUTED") {
    return res.status(409).json({
      error: "You can only answer a record the worker has said is wrong",
    });
  }

  const existing = await prisma.employerStatement.findUnique({
    where: { targetType_targetId: { targetType: kind, targetId: id } },
  });
  if (existing) {
    return res.status(409).json({
      error: "You have already answered this record. An answer cannot be changed.",
    });
  }

  const contractor = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { name: true },
  });

  const result = await prisma.$transaction(async (tx) => {
    const statement = await tx.employerStatement.create({
      data: {
        targetType: kind,
        targetId: id,
        offerId: target.offerId,
        contractorId: req.user!.id,
        note: note.trim(),
      },
    });

    const link = await appendToChain(tx, {
      recordType: "EMPLOYER_NOTE",
      recordId: statement.id,
      // Sealed against the worker's chain, because it belongs to the file about
      // that worker's contract.
      workerId: (
        await tx.workOffer.findUniqueOrThrow({
          where: { id: target.offerId },
          select: { workerId: true },
        })
      ).workerId,
      summary: `${contractor!.name} answered the ${kind === "WORK" ? "work" : "payment"} record ${target.offer.worker.name} said was wrong`,
      payload: {
        type: "EMPLOYER_NOTE",
        targetType: kind,
        targetId: id,
        contractorId: req.user!.id,
        note: note.trim(),
        writtenAt: statement.createdAt.toISOString(),
      },
    });

    return { statement, link };
  });

  return res.status(201).json({
    recorded: true,
    ref: shortRef(result.link.currentHash),
    note: result.statement.note,
    at: result.statement.createdAt,
    // Said plainly, because a contractor who expects this to fix the record
    // should learn immediately that it does not.
    message:
      "Your answer is on the file and cannot be changed. The record still shows that the worker disagrees, and the labour officer will read both accounts.",
  });
});
