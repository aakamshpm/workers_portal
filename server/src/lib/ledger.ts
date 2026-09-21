import { prisma } from "./prisma";
import {
  GENESIS_HASH,
  canonicalPayload,
  computeHash,
  verifyChain,
  type SealedPayload,
  type StoredLink,
  type VerificationResult,
} from "./hashChain";

/**
 * Every write to the record chain goes through this one function.
 *
 * It runs inside a transaction because appending has a read-then-write shape:
 * read the current end of the chain, then write a row that follows on from it.
 * Two simultaneous appends outside a transaction could read the same end and both
 * claim the same position, which would fork the chain. The unique constraint on
 * chainIndex is the backstop - the loser of the race fails loudly rather than
 * writing a corrupt chain.
 *
 * `tx` is the transaction client, passed in so the record row and its chain entry
 * are written together. A record with no chain entry, or a chain entry with no
 * record, would both be corruption.
 */
export async function appendToChain(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  input: {
    recordType: SealedPayload["type"];
    recordId: string;
    workerId: string;
    summary: string;
    payload: SealedPayload;
  },
) {
  const tail = await tx.ledgerEntry.findFirst({
    orderBy: { chainIndex: "desc" },
    select: { chainIndex: true, currentHash: true },
  });

  const chainIndex = tail ? tail.chainIndex + 1 : 0;
  const previousHash = tail ? tail.currentHash : GENESIS_HASH;

  const payload = canonicalPayload(input.payload);
  const currentHash = computeHash(previousHash, payload);

  return tx.ledgerEntry.create({
    data: {
      chainIndex,
      recordType: input.recordType,
      recordId: input.recordId,
      workerId: input.workerId,
      summary: input.summary,
      payload,
      previousHash,
      currentHash,
    },
  });
}

/**
 * ===========================================================================
 * Rebuild the sealed text from the LIVE database row.
 * ===========================================================================
 *
 * This function is the reason the check works, and getting it wrong once silently
 * broke the whole guarantee, so the reasoning is recorded here.
 *
 * The chain stores a `payload` column holding the text that was hashed. The
 * obvious way to check is to hash that stored text and compare it to the stored
 * code. That is worthless: it only proves the chain row agrees with itself.
 * Someone can change WorkOffer.dailyRate from 850 to 600 and the check still
 * passes, because the chain's own copy still says 850 and nothing compares them.
 *
 * So the check must rebuild the text from the CURRENT contents of the WorkOffer /
 * WorkPeriod / Payment tables, hash that, and compare against the stored code.
 * Then changing the live record changes the rebuilt code and the mismatch is
 * caught.
 *
 * The stored `payload` is still kept, but only as evidence: it is what was
 * originally sealed, which lets the failure report show "rate was 850, database
 * now says 600" instead of two unreadable codes.
 *
 * Returns null when the row is gone. A missing row is itself tampering, so the
 * caller reports it rather than treating it as absence of evidence.
 *
 * ACCEPT entries are a special case worth noting: they seal the moment of
 * acceptance, and the fields they cover (the rate agreed, when, and how) are
 * rebuilt from the offer row. That means lowering the rate on an accepted offer
 * breaks TWO records - the offer and the acceptance - which is exactly right,
 * because it contradicts both what was offered and what the worker agreed to.
 */
export async function rebuildPayload(
  recordType: string,
  recordId: string,
): Promise<string | null> {
  if (recordType === "OFFER") {
    const o = await prisma.workOffer.findUnique({ where: { id: recordId } });
    if (!o) return null;
    return canonicalPayload({
      type: "OFFER",
      workerId: o.workerId,
      contractorId: o.contractorId,
      dailyRate: o.dailyRate,
      workType: o.workType,
      siteName: o.siteName,
      startDate: o.startDate.toISOString(),
      expectedDays: o.expectedDays,
      extraTerms: o.extraTerms ?? "",
    });
  }

  if (recordType === "ACCEPT") {
    // The ACCEPT record's id is the offer's id: one acceptance per offer.
    const o = await prisma.workOffer.findUnique({ where: { id: recordId } });
    if (!o || !o.respondedAt) return null;
    return canonicalPayload({
      type: "ACCEPT",
      offerId: o.id,
      workerId: o.workerId,
      dailyRate: o.dailyRate,
      workType: o.workType,
      siteName: o.siteName,
      acceptedAt: o.respondedAt.toISOString(),
      via: o.respondedVia ?? "",
    });
  }

  if (recordType === "WORK") {
    const w = await prisma.workPeriod.findUnique({
      where: { id: recordId },
      include: { offer: { select: { workerId: true } } },
    });
    if (!w) return null;
    return canonicalPayload({
      type: "WORK",
      offerId: w.offerId,
      workerId: w.offer.workerId,
      fromDate: w.fromDate.toISOString(),
      toDate: w.toDate.toISOString(),
      days: w.days,
      note: w.note ?? "",
    });
  }

  if (recordType === "PAYMENT") {
    const p = await prisma.payment.findUnique({
      where: { id: recordId },
      include: { offer: { select: { workerId: true } } },
    });
    if (!p) return null;
    return canonicalPayload({
      type: "PAYMENT",
      offerId: p.offerId,
      workerId: p.offer.workerId,
      amount: p.amount,
      paidOn: p.paidOn.toISOString(),
      method: p.method,
      note: p.note ?? "",
    });
  }

  // CONFIRM and DISPUTE records use a composite id, "WORK:<id>" or
  // "PAYMENT:<id>", because they refer to a row in one of two different tables.
  // Splitting on the first colon tells us where to look.
  if (recordType === "CONFIRM" || recordType === "DISPUTE") {
    const sep = recordId.indexOf(":");
    if (sep === -1) return null;
    const targetType = recordId.slice(0, sep);
    const targetId = recordId.slice(sep + 1);

    if (targetType === "WORK") {
      const w = await prisma.workPeriod.findUnique({
        where: { id: targetId },
        include: { offer: { select: { workerId: true } } },
      });
      if (!w || !w.confirmedAt) return null;

      if (recordType === "CONFIRM") {
        return canonicalPayload({
          type: "CONFIRM",
          targetType: "WORK",
          targetId,
          workerId: w.offer.workerId,
          value: w.days,
          confirmedAt: w.confirmedAt.toISOString(),
          via: w.confirmedVia ?? "",
        });
      }

      return canonicalPayload({
        type: "DISPUTE",
        targetType: "WORK",
        targetId,
        workerId: w.offer.workerId,
        contractorValue: w.days,
        workerValue: w.workerClaimsDays ?? 0,
        note: w.disputeNote ?? "",
        disputedAt: w.confirmedAt.toISOString(),
        via: w.confirmedVia ?? "",
      });
    }

    if (targetType === "PAYMENT") {
      const p = await prisma.payment.findUnique({
        where: { id: targetId },
        include: { offer: { select: { workerId: true } } },
      });
      if (!p || !p.confirmedAt) return null;

      if (recordType === "CONFIRM") {
        return canonicalPayload({
          type: "CONFIRM",
          targetType: "PAYMENT",
          targetId,
          workerId: p.offer.workerId,
          value: p.amount,
          confirmedAt: p.confirmedAt.toISOString(),
          via: p.confirmedVia ?? "",
        });
      }

      return canonicalPayload({
        type: "DISPUTE",
        targetType: "PAYMENT",
        targetId,
        workerId: p.offer.workerId,
        contractorValue: p.amount,
        workerValue: p.workerClaimsAmount ?? 0,
        note: p.disputeNote ?? "",
        disputedAt: p.confirmedAt.toISOString(),
        via: p.confirmedVia ?? "",
      });
    }

    return null;
  }

  // The contractor's answer to a rejected record. Its recordId is the statement
  // row's own id, not a composite, because one EmployerStatement row is the whole
  // record: the target it answers is stored on that row.
  if (recordType === "EMPLOYER_NOTE") {
    const s = await prisma.employerStatement.findUnique({ where: { id: recordId } });
    if (!s) return null;
    return canonicalPayload({
      type: "EMPLOYER_NOTE",
      targetType: s.targetType,
      targetId: s.targetId,
      contractorId: s.contractorId,
      note: s.note,
      writtenAt: s.createdAt.toISOString(),
    });
  }

  return null;
}

/**
 * Rebuild and check the whole chain.
 *
 * Ordered by chainIndex, never by timestamp: chainIndex is unique and defines the
 * canonical order, so the check is deterministic even when two records share a
 * creation time.
 */
export async function verifyLedger(): Promise<VerificationResult> {
  const links = await prisma.ledgerEntry.findMany({
    orderBy: { chainIndex: "asc" },
    select: {
      id: true,
      chainIndex: true,
      recordType: true,
      recordId: true,
      summary: true,
      payload: true,
      previousHash: true,
      currentHash: true,
    },
  });

  const withCurrent: StoredLink[] = await Promise.all(
    links.map(async (link) => ({
      ...link,
      currentPayload: await rebuildPayload(link.recordType, link.recordId),
    })),
  );

  return verifyChain(withCurrent);
}

// ===========================================================================
// The calculation the whole project exists to support.
// ===========================================================================

export interface ContractBalance {
  offerId: string;
  status: string;

  worker: { id: string; name: string; phone: string; homeState: string | null; language: string };
  contractor: { id: string; name: string; phone: string; company: string | null };

  dailyRate: number;
  workType: string;
  siteName: string;
  startDate: Date;
  expectedDays: number;
  extraTerms: string | null;

  acceptedAt: Date | null;
  acceptedVia: string | null;

  /** Sum of days across all work periods. Halves allowed. */
  daysWorked: number;
  /** dailyRate x daysWorked */
  earned: number;
  /** Sum of payments recorded by the contractor. */
  paid: number;
  /** earned - paid. Positive means wages are owed. */
  balance: number;

  // ------------------------------------------------------------------------
  // Confirmed versus unconfirmed.
  //
  // The single total is not honest on its own, because the contractor writes the
  // work log. A day the worker has confirmed is agreed by both sides; a day
  // nobody has confirmed is one person's claim. Reporting them separately is
  // what stops the interface presenting an unverified figure as a fact.
  // ------------------------------------------------------------------------
  /** Days the worker has confirmed. */
  daysConfirmed: number;
  /** Days recorded but not yet answered by the worker. */
  daysWaiting: number;
  /** Days the worker says are wrong. */
  daysDisputed: number;
  /** dailyRate x daysConfirmed - the part of the earnings both sides agree on. */
  earnedConfirmed: number;

  /** Payments the worker has confirmed receiving. */
  paidConfirmed: number;
  /** Payments recorded but not yet answered. */
  paidWaiting: number;
  /** Payments the worker says they did not receive. */
  paidDisputed: number;

  /** How many records are still waiting for the worker to answer. */
  awaitingConfirmation: number;
  /** How many records the worker has rejected. Anything above zero needs an officer. */
  disputedRecords: number;

  periodCount: number;
  paymentCount: number;
  lastPaymentOn: Date | null;
  openComplaints: number;
}

/**
 * Answer "what am I owed?" for one contract.
 *
 * This is the number a worker cannot produce today, and the reason the system
 * exists. Every input traces back to a sealed record, so the figure is checkable
 * rather than a claim.
 */
export async function computeBalance(offerId: string): Promise<ContractBalance | null> {
  const offer = await prisma.workOffer.findUnique({
    where: { id: offerId },
    include: {
      worker: { select: { id: true, name: true, phone: true, homeState: true, language: true } },
      contractor: { select: { id: true, name: true, phone: true, company: true } },
      workPeriods: { select: { days: true, confirmState: true } },
      payments: { select: { amount: true, paidOn: true, confirmState: true } },
      complaints: { select: { status: true } },
    },
  });

  if (!offer) return null;

  const sumBy = <T,>(rows: T[], pick: (r: T) => number, keep: (r: T) => boolean) =>
    rows.filter(keep).reduce((sum, r) => sum + pick(r), 0);

  const periods = offer.workPeriods;
  const payments = offer.payments;

  const daysWorked = sumBy(periods, (p) => p.days, () => true);
  const daysConfirmed = sumBy(periods, (p) => p.days, (p) => p.confirmState === "CONFIRMED");
  const daysWaiting = sumBy(periods, (p) => p.days, (p) => p.confirmState === "WAITING");
  const daysDisputed = sumBy(periods, (p) => p.days, (p) => p.confirmState === "DISPUTED");

  const earned = offer.dailyRate * daysWorked;
  const earnedConfirmed = offer.dailyRate * daysConfirmed;

  const paid = sumBy(payments, (p) => p.amount, () => true);
  const paidConfirmed = sumBy(payments, (p) => p.amount, (p) => p.confirmState === "CONFIRMED");
  const paidWaiting = sumBy(payments, (p) => p.amount, (p) => p.confirmState === "WAITING");
  const paidDisputed = sumBy(payments, (p) => p.amount, (p) => p.confirmState === "DISPUTED");

  const awaitingConfirmation =
    periods.filter((p) => p.confirmState === "WAITING").length +
    payments.filter((p) => p.confirmState === "WAITING").length;

  const disputedRecords =
    periods.filter((p) => p.confirmState === "DISPUTED").length +
    payments.filter((p) => p.confirmState === "DISPUTED").length;

  // Money is rounded to paise at the boundary so repeated float addition cannot
  // surface a balance like 4199.999999994 in the interface.
  const round = (n: number) => Math.round(n * 100) / 100;

  const lastPaymentOn = offer.payments.reduce<Date | null>(
    (latest, p) => (latest === null || p.paidOn > latest ? p.paidOn : latest),
    null,
  );

  return {
    offerId: offer.id,
    status: offer.status,
    worker: offer.worker,
    contractor: offer.contractor,
    dailyRate: offer.dailyRate,
    workType: offer.workType,
    siteName: offer.siteName,
    startDate: offer.startDate,
    expectedDays: offer.expectedDays,
    extraTerms: offer.extraTerms,
    acceptedAt: offer.respondedAt,
    acceptedVia: offer.respondedVia,
    daysWorked: round(daysWorked),
    earned: round(earned),
    paid: round(paid),
    balance: round(earned - paid),

    daysConfirmed: round(daysConfirmed),
    daysWaiting: round(daysWaiting),
    daysDisputed: round(daysDisputed),
    earnedConfirmed: round(earnedConfirmed),

    paidConfirmed: round(paidConfirmed),
    paidWaiting: round(paidWaiting),
    paidDisputed: round(paidDisputed),

    awaitingConfirmation,
    disputedRecords,

    periodCount: offer.workPeriods.length,
    paymentCount: offer.payments.length,
    lastPaymentOn,
    openComplaints: offer.complaints.filter(
      (c) => c.status === "OPEN" || c.status === "AWAITING_EMPLOYER",
    ).length,
  };
}

/** Balances for a set of offers, newest first. */
async function balancesFor(where: Record<string, unknown>): Promise<ContractBalance[]> {
  const offers = await prisma.workOffer.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  const balances = await Promise.all(offers.map((o) => computeBalance(o.id)));
  return balances.filter((b): b is ContractBalance => b !== null);
}

/** Accepted contracts for one worker. */
export function balancesForWorker(workerId: string) {
  return balancesFor({ workerId, status: "ACCEPTED" });
}

/** Accepted contracts for one contractor. */
export function balancesForContractor(contractorId: string) {
  return balancesFor({ contractorId, status: "ACCEPTED" });
}

/** Every accepted contract, for the labour officer. */
export function allBalances() {
  return balancesFor({ status: "ACCEPTED" });
}
