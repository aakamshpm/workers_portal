import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../lib/auth";
import { computeBalance } from "../lib/ledger";
import { authorityMessage, send, shortRef, type Language } from "../lib/sms";

export const complaintsRouter = Router();

complaintsRouter.use(requireAuth);

/**
 * Complaint categories.
 *
 * A fixed list rather than free text alone, because it lets the worker file
 * something useful without writing an essay, and it lets the authority sort a
 * queue. The free-text description is still there for the detail.
 */
export const CATEGORIES = [
  { id: "UNPAID", label: "He has given me no money at all" },
  { id: "UNDERPAID", label: "He gave me less money than he should have" },
  { id: "RATE_DISPUTE", label: "The daily pay is not what we agreed" },
  { id: "DAYS_DISPUTE", label: "The number of days written down is wrong" },
  { id: "CONDITIONS", label: "The place I work or stay is bad" },
  { id: "OTHER", label: "Something else" },
] as const;

complaintsRouter.get("/categories", (_req, res) => res.json(CATEGORIES));

const complaintSelect = {
  id: true,
  category: true,
  description: true,
  language: true,
  claimedAmount: true,
  status: true,
  outcome: true,
  outcomeNote: true,
  closedAt: true,
  createdAt: true,
  offerId: true,
  raisedBy: { select: { id: true, name: true, phone: true, homeState: true, language: true } },
  actions: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      kind: true,
      note: true,
      escalatedTo: true,
      createdAt: true,
      author: { select: { id: true, name: true, role: true } },
    },
  },
} as const;

/**
 * Attach the contract and its money to each complaint.
 *
 * The balance is the context that makes a complaint actionable. "I am owed
 * ₹10,500" means nothing on its own; next to the agreed rate, the days recorded
 * and the payments made, it is either supported or it is not.
 */
async function decorate<T extends { offerId: string }>(rows: T[]) {
  const cache = new Map<string, Awaited<ReturnType<typeof computeBalance>>>();

  return Promise.all(
    rows.map(async (row) => {
      if (!cache.has(row.offerId)) {
        cache.set(row.offerId, await computeBalance(row.offerId));
      }
      return { ...row, contract: cache.get(row.offerId) ?? null };
    }),
  );
}

// ---------------------------------------------------------------------------
// GET /api/complaints
//
// WORKER     -> only their own
// CONTRACTOR -> complaints about their own contracts
// AUTHORITY  -> everything, with ?status= to focus the queue
// ---------------------------------------------------------------------------
complaintsRouter.get("/", async (req, res) => {
  const user = req.user!;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;

  const scope =
    user.role === "WORKER"
      ? { raisedById: user.id }
      : user.role === "CONTRACTOR"
        ? { offer: { contractorId: user.id } }
        : {};

  const complaints = await prisma.complaint.findMany({
    where: status ? { ...scope, status } : scope,
    // Open cases first, then newest, so the officer's queue is actionable
    // without extra filtering.
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    select: complaintSelect,
  });

  return res.json(await decorate(complaints));
});

// ---------------------------------------------------------------------------
// GET /api/complaints/disputed-records
//
// Records the worker rejected, for the labour officer.
//
// These are complaints in everything but name, and they arrive without the worker
// having to write anything: the contractor recorded 6 days, the worker replied
// WRONG, and both figures are already sealed. Showing them next to the written
// complaints means the officer sees every disagreement in one place.
//
// This is also the queue that makes the confirmation design worth building. A
// contractor who understates a week is not caught by the record chain - they are
// caught here, by the worker, the same day.
// ---------------------------------------------------------------------------
complaintsRouter.get("/disputed-records", requireRole("AUTHORITY"), async (req, res) => {
  // Reviewed disagreements leave the queue but are never deleted. ?reviewed=1
  // brings them back, because "what did my office already decide about this
  // contractor" is a real question and the answer must not be unreachable.
  const wantReviewed = req.query.reviewed === "1";

  const reviews = await prisma.disputeReview.findMany({
    include: { officer: { select: { id: true, name: true } } },
  });
  const reviewOf = new Map(reviews.map((r) => [`${r.targetType}:${r.targetId}`, r]));

  const periods = await prisma.workPeriod.findMany({
    where: { confirmState: "DISPUTED" },
    orderBy: { confirmedAt: "desc" },
    include: {
      offer: {
        select: {
          id: true,
          dailyRate: true,
          siteName: true,
          worker: { select: { id: true, name: true, phone: true, homeState: true, language: true } },
          contractor: { select: { id: true, name: true, phone: true, company: true } },
        },
      },
    },
  });

  const payments = await prisma.payment.findMany({
    where: { confirmState: "DISPUTED" },
    orderBy: { confirmedAt: "desc" },
    include: {
      offer: {
        select: {
          id: true,
          siteName: true,
          worker: { select: { id: true, name: true, phone: true, homeState: true, language: true } },
          contractor: { select: { id: true, name: true, phone: true, company: true } },
        },
      },
    },
  });

  // Complaints already closed on these contracts. A disagreement whose contract
  // carries a decided complaint is very often the same matter under another name,
  // and saying so on screen is what stops the officer working it twice.
  const closedComplaints = await prisma.complaint.findMany({
    where: { status: { in: ["RESOLVED", "REJECTED", "CLOSED_UNPROVEN", "ESCALATED"] } },
    orderBy: { closedAt: "desc" },
    select: {
      offerId: true,
      status: true,
      outcome: true,
      outcomeNote: true,
      closedAt: true,
      createdAt: true,
    },
  });
  const closedFor = new Map<string, (typeof closedComplaints)[number]>();
  for (const c of closedComplaints) {
    if (!closedFor.has(c.offerId)) closedFor.set(c.offerId, c);
  }

  // The contractor's answer, where he has written one. A disputed record with no
  // statement is different from one the employer has explained, and the officer
  // must be able to tell those apart before deciding.
  const statements = await prisma.employerStatement.findMany({
    select: { targetType: true, targetId: true, note: true, createdAt: true },
  });
  const employerSaid = new Map(statements.map((s) => [`${s.targetType}:${s.targetId}`, s]));
  const answer = (kind: string, id: string) => {
    const s = employerSaid.get(`${kind}:${id}`);
    return s ? { note: s.note, at: s.createdAt } : null;
  };

  const reviewFor = (kind: string, id: string) => {
    const r = reviewOf.get(`${kind}:${id}`);
    return r
      ? { reason: r.reason, note: r.note, at: r.createdAt, officer: r.officer }
      : null;
  };

  const related = (offerId: string) => {
    const c = closedFor.get(offerId);
    return c
      ? { status: c.status, outcome: c.outcome, note: c.outcomeNote, closedAt: c.closedAt }
      : null;
  };

  const items = [
    ...periods.map((p) => ({
      kind: "WORK" as const,
      id: p.id,
      offerId: p.offer.id,
      siteName: p.offer.siteName,
      worker: p.offer.worker,
      contractor: p.offer.contractor,
      contractorSays: `${p.days} days`,
      workerSays: p.workerClaimsDays !== null ? `${p.workerClaimsDays} days` : "not stated yet",
      gapValue:
        p.workerClaimsDays !== null
          ? Math.round((p.workerClaimsDays - p.days) * p.offer.dailyRate * 100) / 100
          : null,
      period: `${p.fromDate.toISOString().slice(0, 10)} to ${p.toDate.toISOString().slice(0, 10)}`,
      note: p.disputeNote,
      via: p.confirmedVia,
      at: p.confirmedAt,
      employerStatement: answer("WORK", p.id),
      review: reviewFor("WORK", p.id),
      relatedComplaint: related(p.offer.id),
    })),
    ...payments.map((p) => ({
      kind: "PAYMENT" as const,
      id: p.id,
      offerId: p.offer.id,
      siteName: p.offer.siteName,
      worker: p.offer.worker,
      contractor: p.offer.contractor,
      contractorSays: `Rs ${p.amount.toFixed(0)} paid`,
      workerSays:
        p.workerClaimsAmount !== null ? `Rs ${p.workerClaimsAmount.toFixed(0)} received` : "not stated yet",
      gapValue:
        p.workerClaimsAmount !== null
          ? Math.round((p.amount - p.workerClaimsAmount) * 100) / 100
          : null,
      period: p.paidOn.toISOString().slice(0, 10),
      note: p.disputeNote,
      via: p.confirmedVia,
      at: p.confirmedAt,
      employerStatement: answer("PAYMENT", p.id),
      review: reviewFor("PAYMENT", p.id),
      relatedComplaint: related(p.offer.id),
    })),
  ]
    .filter((it) => (wantReviewed ? it.review !== null : it.review === null))
    .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));

  return res.json(items);
});

// ---------------------------------------------------------------------------
// GET /api/complaints/track-record/:offerId
//
// Both parties' history on one screen, for the officer facing an unprovable
// dispute.
//
// This is NOT a lie detector and the response says so. It answers one narrow
// question: across all their other records, how have these two behaved? A worker
// who has confirmed eleven records and disputed one is in a different position
// from a worker who disputes everything. A contractor whose payments are all
// code-confirmed except the disputed one is in a different position from a
// contractor who never attaches proof to anything.
//
// Pattern is not evidence about a specific payment. It is context for a human
// decision, which is what a labour officer actually works with.
// ---------------------------------------------------------------------------
complaintsRouter.get("/track-record/:offerId", requireRole("AUTHORITY"), async (req, res) => {
  const offerId = String(req.params.offerId);

  const offer = await prisma.workOffer.findUnique({
    where: { id: offerId },
    select: {
      workerId: true,
      contractorId: true,
      worker: { select: { id: true, name: true, phone: true } },
      contractor: { select: { id: true, name: true, phone: true, company: true } },
    },
  });
  if (!offer) return res.status(404).json({ error: "That work does not exist" });

  /** Confirmation behaviour for one worker, across every contract they have had. */
  async function workerRecord(workerId: string) {
    const periods = await prisma.workPeriod.findMany({
      where: { offer: { workerId } },
      select: { confirmState: true },
    });
    const payments = await prisma.payment.findMany({
      where: { offer: { workerId } },
      select: { confirmState: true, proofType: true },
    });
    const complaints = await prisma.complaint.findMany({
      where: { raisedById: workerId },
      select: { status: true, outcome: true },
    });

    const count = (rows: { confirmState: string }[], state: string) =>
      rows.filter((r) => r.confirmState === state).length;

    return {
      workRecordsConfirmed: count(periods, "CONFIRMED"),
      workRecordsDisputed: count(periods, "DISPUTED"),
      workRecordsWaiting: count(periods, "WAITING"),
      paymentsConfirmed: count(payments, "CONFIRMED"),
      paymentsDisputed: count(payments, "DISPUTED"),
      paymentsWaiting: count(payments, "WAITING"),
      complaintsFiled: complaints.length,
      complaintsUpheld: complaints.filter((c) => c.outcome === "UPHELD").length,
      complaintsRejected: complaints.filter((c) => c.outcome === "REJECTED").length,
      complaintsUnproven: complaints.filter((c) => c.outcome === "UNPROVEN").length,
    };
  }

  /** Payment practice for one contractor, across every worker they have hired. */
  async function contractorRecord(contractorId: string) {
    const payments = await prisma.payment.findMany({
      where: { offer: { contractorId } },
      select: { confirmState: true, proofType: true, method: true },
    });
    const complaints = await prisma.complaint.findMany({
      where: { offer: { contractorId } },
      select: { status: true, outcome: true },
    });
    const periods = await prisma.workPeriod.findMany({
      where: { offer: { contractorId } },
      select: { confirmState: true },
    });

    return {
      paymentsTotal: payments.length,
      // The number that matters most: how often this contractor bothers to
      // create proof at the moment of payment.
      paymentsWithProof: payments.filter((p) => p.proofType !== "NONE").length,
      paymentsWithBankTrail: payments.filter((p) => p.proofType === "REFERENCE").length,
      paymentsWithCode: payments.filter((p) => p.proofType === "CODE").length,
      paymentsNoProof: payments.filter((p) => p.proofType === "NONE").length,
      paymentsDisputed: payments.filter((p) => p.confirmState === "DISPUTED").length,
      workRecordsDisputed: periods.filter((p) => p.confirmState === "DISPUTED").length,
      complaintsAgainst: complaints.length,
      complaintsUpheld: complaints.filter((c) => c.outcome === "UPHELD").length,
      complaintsRejected: complaints.filter((c) => c.outcome === "REJECTED").length,
      complaintsUnproven: complaints.filter((c) => c.outcome === "UNPROVEN").length,
    };
  }

  return res.json({
    worker: { ...offer.worker, history: await workerRecord(offer.workerId) },
    contractor: { ...offer.contractor, history: await contractorRecord(offer.contractorId) },
    // Read only by the labour officer, on the track-record panel, so the wording
    // here is official rather than worker-facing.
    caution:
      "This is past conduct, not evidence about the payment in question. Where cash changed hands with no witness, no record system can establish which party is truthful. Use this as background only, and where proof is absent, close the case as Unproven.",
  });
});

const fileSchema = z.object({
  offerId: z.string().min(1, "Choose which work this is about"),
  category: z.string().min(1, "Choose what the problem is"),
  description: z.string().min(10, "Please describe the problem in a little more detail").max(2000),
  language: z.enum(["en", "hi", "bn", "ml", "or"]).optional(),
  claimedAmount: z.coerce.number().positive().optional(),
});

// ---------------------------------------------------------------------------
// POST /api/complaints
//
// The worker files a complaint against one of their own contracts.
//
// Filing changes nothing in the record chain. The contract stays frozen and the
// objection is stored beside it - which is why the ledger can be append-only and
// still handle disagreement.
//
// The worker writes in their own language, and the language is stored, so the
// officer knows whether translation is needed before acting.
// ---------------------------------------------------------------------------
complaintsRouter.post("/", requireRole("WORKER"), async (req, res) => {
  const parsed = fileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }

  const { offerId, category, description, claimedAmount } = parsed.data;
  const worker = req.user!;

  const offer = await prisma.workOffer.findUnique({
    where: { id: offerId },
    select: { id: true, workerId: true, status: true },
  });

  if (!offer) return res.status(404).json({ error: "That work does not exist" });
  if (offer.workerId !== worker.id) {
    return res.status(403).json({ error: "You can only complain about your own work" });
  }
  if (offer.status !== "ACCEPTED") {
    return res.status(409).json({
      error: "You can only complain about work you accepted",
    });
  }

  const complaint = await prisma.complaint.create({
    data: {
      offerId,
      raisedById: worker.id,
      category,
      description: description.trim(),
      language: parsed.data.language ?? worker.language ?? "en",
      claimedAmount: claimedAmount ?? null,
      status: "OPEN",
    },
    select: complaintSelect,
  });

  const [decorated] = await decorate([complaint]);
  return res.status(201).json(decorated);
});

const askSchema = z.object({
  note: z.string().min(5, "Say what you are asking the contractor for").max(1000),
});

// ---------------------------------------------------------------------------
// POST /api/complaints/:id/ask-employer
//
// The authority asks the contractor to explain before deciding anything.
//
// This is deliberately the first available action, and the reason is practical:
// most wage complaints are careless record-keeping rather than deliberate theft.
// Giving the contractor a chance to answer settles many cases without a formal
// ruling, and where it does not, the officer now has both accounts on record.
// ---------------------------------------------------------------------------
complaintsRouter.post("/:id/ask-employer", requireRole("AUTHORITY"), async (req, res) => {
  const parsed = askSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }

  const id = String(req.params.id);
  const complaint = await prisma.complaint.findUnique({ where: { id }, select: { status: true } });
  if (!complaint) return res.status(404).json({ error: "That complaint does not exist" });
  if (complaint.status === "RESOLVED" || complaint.status === "REJECTED") {
    return res.status(409).json({ error: "That complaint is already closed" });
  }

  await prisma.complaintAction.create({
    data: { complaintId: id, authorId: req.user!.id, kind: "ASKED_EMPLOYER", note: parsed.data.note.trim() },
  });

  const updated = await prisma.complaint.update({
    where: { id },
    data: { status: "AWAITING_EMPLOYER" },
    select: complaintSelect,
  });

  const [decorated] = await decorate([updated]);
  return res.json(decorated);
});

const employerReplySchema = z.object({
  note: z.string().min(5, "Type your explanation").max(2000),
});

// ---------------------------------------------------------------------------
// POST /api/complaints/:id/employer-reply
// The contractor answers. Their reply is recorded, not acted on automatically.
// ---------------------------------------------------------------------------
complaintsRouter.post("/:id/employer-reply", requireRole("CONTRACTOR"), async (req, res) => {
  const parsed = employerReplySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }

  const id = String(req.params.id);
  const complaint = await prisma.complaint.findUnique({
    where: { id },
    select: { status: true, offer: { select: { contractorId: true } } },
  });

  if (!complaint) return res.status(404).json({ error: "That complaint does not exist" });
  if (complaint.offer.contractorId !== req.user!.id) {
    return res.status(403).json({ error: "That complaint is not about your contract" });
  }

  await prisma.complaintAction.create({
    data: {
      complaintId: id,
      authorId: req.user!.id,
      kind: "EMPLOYER_REPLY",
      note: parsed.data.note.trim(),
    },
  });

  // Back to OPEN so it returns to the officer's queue with the reply attached.
  const updated = await prisma.complaint.update({
    where: { id },
    data: { status: "OPEN" },
    select: complaintSelect,
  });

  const [decorated] = await decorate([updated]);
  return res.json(decorated);
});

const contactSchema = z.object({
  kind: z.enum(["CALLED_WORKER", "CALLED_EMPLOYER", "MESSAGED_WORKER"]),
  note: z.string().min(3, "Add a short note about what was said").max(1000),
});

// ---------------------------------------------------------------------------
// POST /api/complaints/:id/contact
//
// Records that the officer phoned someone, or sends the worker a message.
//
// Phone calls are NOT placed by the system - the interface gives the officer a
// tap-to-dial link and this route records that the call happened. Pretending to
// place a call would be a lie in a demo; recording a real call that the officer
// made from their own phone is what a case file actually needs.
// ---------------------------------------------------------------------------
complaintsRouter.post("/:id/contact", requireRole("AUTHORITY"), async (req, res) => {
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }

  const id = String(req.params.id);
  const complaint = await prisma.complaint.findUnique({
    where: { id },
    select: {
      status: true,
      raisedById: true,
      raisedBy: { select: { language: true } },
      offerId: true,
    },
  });
  if (!complaint) return res.status(404).json({ error: "That complaint does not exist" });

  await prisma.complaintAction.create({
    data: {
      complaintId: id,
      authorId: req.user!.id,
      kind: parsed.data.kind,
      note: parsed.data.note.trim(),
    },
  });

  // A portal message is also sent to the worker's phone by SMS, because that is
  // the channel he actually reads.
  if (parsed.data.kind === "MESSAGED_WORKER") {
    const link = await prisma.ledgerEntry.findFirst({
      where: { recordType: "ACCEPT", recordId: complaint.offerId },
      select: { currentHash: true },
    });
    const ref = link ? shortRef(link.currentHash) : "0000";

    await send({
      userId: complaint.raisedById,
      kind: "AUTHORITY",
      reference: ref,
      language: complaint.raisedBy.language,
      body: authorityMessage(req.user!.name, parsed.data.note.trim(), ref),
    });
  }

  const updated = await prisma.complaint.findUnique({ where: { id }, select: complaintSelect });
  const [decorated] = await decorate([updated!]);
  return res.json(decorated);
});

const decideSchema = z.object({
  outcome: z.enum(["UPHELD", "REJECTED", "SETTLED", "UNPROVEN"]),
  note: z.string().min(10, "Write the reason for your decision").max(2000),
});

// ---------------------------------------------------------------------------
// POST /api/complaints/:id/decide
//
// Close the case. Four outcomes, and each exists because the other three would
// misrecord a real situation:
//
//   UPHELD   - the worker was right. Wages are owed.
//   REJECTED - the records contradict the claim. The contractor did nothing wrong.
//   SETTLED  - the complaint was valid AND the contractor fixed it after being
//              asked. Not the same fact about the contractor as a rejection, and
//              recording it as one would be unfair to the worker.
//   UNPROVEN - nobody can tell.
//
// UNPROVEN is the important one, and it exists for the case this system cannot
// solve: an unwitnessed cash handover with no proof attached. The contractor says
// the money was paid, the worker says it was not, and there is no code, no
// reference, and no witness. No amount of hashing reaches back and observes what
// happened in that room.
//
// Forcing the officer to pick UPHELD or REJECTED there would make the system
// manufacture a finding out of nothing, and record one party as a liar on no
// evidence. UNPROVEN closes the case honestly: the disagreement is documented,
// the absence of proof is documented, and neither person is branded. It also
// makes the pattern visible - a contractor with several UNPROVEN cash disputes
// is telling the labour office something, even if no single case is provable.
// ---------------------------------------------------------------------------
complaintsRouter.post("/:id/decide", requireRole("AUTHORITY"), async (req, res) => {
  const parsed = decideSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }

  const id = String(req.params.id);
  const complaint = await prisma.complaint.findUnique({
    where: { id },
    select: { status: true, raisedById: true, raisedBy: { select: { language: true } }, offerId: true },
  });
  if (!complaint) return res.status(404).json({ error: "That complaint does not exist" });
  if (
    complaint.status === "RESOLVED" ||
    complaint.status === "REJECTED" ||
    complaint.status === "CLOSED_UNPROVEN"
  ) {
    return res.status(409).json({ error: "That complaint is already closed" });
  }

  const { outcome, note } = parsed.data;
  // UNPROVEN closes the case as CLOSED_UNPROVEN rather than as resolved or
  // rejected, so statistics never count an unprovable case as a finding either way.
  const status =
    outcome === "REJECTED" ? "REJECTED" : outcome === "UNPROVEN" ? "CLOSED_UNPROVEN" : "RESOLVED";

  await prisma.complaintAction.create({
    data: { complaintId: id, authorId: req.user!.id, kind: "DECIDED", note: note.trim() },
  });

  const updated = await prisma.complaint.update({
    where: { id },
    data: { status, outcome, outcomeNote: note.trim(), closedAt: new Date() },
    select: complaintSelect,
  });

  const link = await prisma.ledgerEntry.findFirst({
    where: { recordType: "ACCEPT", recordId: complaint.offerId },
    select: { currentHash: true },
  });
  const ref = link ? shortRef(link.currentHash) : "0000";

  const heading =
    outcome === "UPHELD"
      ? "Your complaint was accepted."
      : outcome === "SETTLED"
        ? "Your complaint was settled."
        : outcome === "UNPROVEN"
          ? "Your complaint could not be proved either way, and has been recorded."
          : "Your complaint was not accepted.";

  await send({
    userId: complaint.raisedById,
    kind: "AUTHORITY",
    reference: ref,
    language: complaint.raisedBy.language,
    body: authorityMessage(req.user!.name, `${heading} ${note.trim()}`, ref),
  });

  const [decorated] = await decorate([updated]);
  return res.json(decorated);
});

const escalateSchema = z.object({
  to: z.enum(["LABOUR_COMMISSIONER", "POLICE"]),
  note: z.string().min(10, "Write why this is being referred on").max(2000),
});

// ---------------------------------------------------------------------------
// POST /api/complaints/:id/escalate
//
// Refer the case beyond the labour office.
//
// Two destinations, and the distinction matters. Unpaid wages are a labour
// matter, and the Labour Commissioner has the power to recover them. Police
// involvement belongs to cases with a criminal element - confiscated identity
// documents, confinement, threats, assault. Sending a plain wage dispute to the
// police would be the wrong referral, and for an undocumented migrant worker it
// can rebound on the worker rather than the contractor.
//
// So the interface asks where, and requires a written reason.
// ---------------------------------------------------------------------------
complaintsRouter.post("/:id/escalate", requireRole("AUTHORITY"), async (req, res) => {
  const parsed = escalateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }

  const id = String(req.params.id);
  const complaint = await prisma.complaint.findUnique({
    where: { id },
    select: { status: true, raisedById: true, raisedBy: { select: { language: true } }, offerId: true },
  });
  if (!complaint) return res.status(404).json({ error: "That complaint does not exist" });

  const { to, note } = parsed.data;

  await prisma.complaintAction.create({
    data: {
      complaintId: id,
      authorId: req.user!.id,
      kind: "ESCALATED",
      note: note.trim(),
      escalatedTo: to,
    },
  });

  const updated = await prisma.complaint.update({
    where: { id },
    data: { status: "ESCALATED" },
    select: complaintSelect,
  });

  const where = to === "POLICE" ? "the police" : "the Labour Commissioner";
  await send({
    userId: complaint.raisedById,
    kind: "AUTHORITY",
    language: complaint.raisedBy.language,
    body: authorityMessage(
      req.user!.name,
      `Your complaint has been referred to ${where}. ${note.trim()}`,
      "0000",
    ),
  });

  const [decorated] = await decorate([updated]);
  return res.json(decorated);
});

const reviewSchema = z.object({
  kind: z.enum(["WORK", "PAYMENT"]),
  id: z.string().min(1),
  reason: z.enum(["SETTLED_OUTSIDE", "DECIDED", "NO_ACTION", "UNPROVABLE"]),
  note: z
    .string()
    .min(10, "Write what you found, so the next officer does not start again")
    .max(1000),
});

// ---------------------------------------------------------------------------
// POST /api/complaints/dispute-review
//
// The officer marks a disagreement as no longer needing attention.
//
// Why this route exists at all: a dispute settled by a phone call left no trace
// anywhere the queue could see, so it stayed in the list looking as urgent as a
// new one. The next officer - or the same officer months later - would contact a
// contractor about a matter already closed.
//
// What it does NOT do, and each of these is deliberate:
//
//   - It does not change the WorkPeriod or the Payment. The two figures the
//     parties gave are sealed evidence and remain exactly as they were.
//   - It does not clear `confirmState`. The record stays DISPUTED for ever,
//     because the disagreement genuinely happened and the file should say so.
//   - It is not added to the hash chain. The chain protects what the worker and
//     the contractor stated. An officer's case-handling note is administration
//     on top of that evidence; sealing it would suggest her opinion carries the
//     same weight as their figures.
//
// The note is required and has a minimum length, because a review with no reason
// recreates the original problem in a quieter form: the next officer sees the
// matter was closed but not why, and has to redo the work anyway.
// ---------------------------------------------------------------------------
complaintsRouter.post("/dispute-review", requireRole("AUTHORITY"), async (req, res) => {
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }

  const { kind, id, reason, note } = parsed.data;

  const target =
    kind === "WORK"
      ? await prisma.workPeriod.findUnique({
          where: { id },
          select: { offerId: true, confirmState: true },
        })
      : await prisma.payment.findUnique({
          where: { id },
          select: { offerId: true, confirmState: true },
        });

  if (!target) return res.status(404).json({ error: "That record does not exist" });
  if (target.confirmState !== "DISPUTED") {
    return res.status(409).json({
      error: "Only a record the worker has disputed can be reviewed",
    });
  }

  const existing = await prisma.disputeReview.findUnique({
    where: { targetType_targetId: { targetType: kind, targetId: id } },
  });
  if (existing) {
    return res.status(409).json({
      error: "This disagreement has already been reviewed. Reopen it if you need to act again.",
    });
  }

  const review = await prisma.disputeReview.create({
    data: {
      targetType: kind,
      targetId: id,
      offerId: target.offerId,
      officerId: req.user!.id,
      reason,
      note: note.trim(),
    },
  });

  return res.status(201).json({
    reviewed: true,
    reason: review.reason,
    note: review.note,
    at: review.createdAt,
    message:
      "Taken off your list. The record still shows the two sides disagree, and your note is on the file for whoever looks next.",
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/complaints/dispute-review
//
// Reopen a disagreement the office had closed.
//
// Needed because circumstances change: a settlement falls through, or a worker
// comes back. Deleting the review row returns the record to the queue and leaves
// the sealed evidence untouched, exactly as it was before the review existed.
//
// This does remove the officer's note, which is the one destructive action in the
// whole system. It is acceptable here only because the note is administration
// rather than evidence - nothing either party stated is affected.
// ---------------------------------------------------------------------------
complaintsRouter.delete("/dispute-review", requireRole("AUTHORITY"), async (req, res) => {
  const kind = typeof req.query.kind === "string" ? req.query.kind : "";
  const id = typeof req.query.id === "string" ? req.query.id : "";

  if (kind !== "WORK" && kind !== "PAYMENT") {
    return res.status(400).json({ error: "Say whether this is a WORK or PAYMENT record" });
  }
  if (!id) return res.status(400).json({ error: "Which record?" });

  const existing = await prisma.disputeReview.findUnique({
    where: { targetType_targetId: { targetType: kind, targetId: id } },
  });
  if (!existing) {
    return res.status(404).json({ error: "That disagreement is not marked as reviewed" });
  }

  await prisma.disputeReview.delete({ where: { id: existing.id } });

  return res.json({
    reopened: true,
    message: "Back on your list. Nothing the worker or the contractor recorded has changed.",
  });
});
