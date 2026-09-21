import { prisma } from "../lib/prisma";
import { appendToChain, computeBalance } from "../lib/ledger";
import {
  confirmedReceipt,
  disputedReceipt,
  send,
  shortRef,
  type Language,
} from "../lib/sms";

/**
 * ===========================================================================
 * Worker confirmation of work and payment records.
 * ===========================================================================
 *
 * Why this exists at all:
 *
 * The work log is written by the contractor. Sealing it protects it from being
 * changed later, but says nothing about whether it was true when written. A
 * contractor who records 3 days for a 6-day week produces a perfectly valid,
 * permanently sealed lie - the chain would be protecting the falsehood.
 *
 * So every work and payment record is sent to the worker, who answers OK or
 * WRONG. Three consequences:
 *
 *   - A confirmed record was written by both sides. That is evidence.
 *   - An unconfirmed record is labelled as unconfirmed everywhere it appears,
 *     and counted separately in the balance. It is one person's claim.
 *   - A rejected record goes to the labour officer with both figures sealed.
 *
 * This file holds the shared logic. Both the SMS route and the website route
 * call `respondToRecord`, so the two channels cannot drift apart - a worker's
 * "OK" must mean exactly the same thing however it arrives.
 */

export type TargetType = "WORK" | "PAYMENT";

/** Find the record a 4-digit reply code refers to, for one specific worker. */
export async function findPendingByRef(
  workerId: string,
  ref: string | undefined,
): Promise<{ targetType: TargetType; targetId: string } | null> {
  const waitingWork = await prisma.workPeriod.findMany({
    where: { confirmState: "WAITING", offer: { workerId } },
    select: { id: true },
  });
  const waitingPay = await prisma.payment.findMany({
    where: { confirmState: "WAITING", offer: { workerId } },
    select: { id: true },
  });

  const candidates: { targetType: TargetType; targetId: string }[] = [
    ...waitingWork.map((w) => ({ targetType: "WORK" as const, targetId: w.id })),
    ...waitingPay.map((p) => ({ targetType: "PAYMENT" as const, targetId: p.id })),
  ];

  if (ref) {
    for (const c of candidates) {
      const link = await prisma.ledgerEntry.findFirst({
        where: { recordType: c.targetType, recordId: c.targetId },
        select: { currentHash: true },
      });
      if (link && shortRef(link.currentHash) === ref) return c;
    }
    return null;
  }

  // No code given. If exactly one record is waiting, the reply is unambiguous,
  // so accept it - a worker who types just "OK" should not be rejected. With
  // more than one waiting we refuse to guess, because confirming the wrong
  // record would create false evidence.
  return candidates.length === 1 ? candidates[0]! : null;
}

/**
 * Apply a worker's answer to a work or payment record.
 *
 * Returns what happened, so the caller can report it and the SMS page can show
 * the right receipt.
 */
export async function respondToRecord(input: {
  workerId: string;
  targetType: TargetType;
  targetId: string;
  decision: "CONFIRM" | "REJECT";
  via: "SMS" | "WEB";
  /** The worker's own figure, when rejecting. Days for work, rupees for payment. */
  workerValue?: number;
  note?: string;
}) {
  const respondedAt = new Date();
  const { workerId, targetType, targetId, decision, via } = input;

  // Load the record and check it belongs to this worker and is still waiting.
  // Both checks matter: the first stops a worker confirming someone else's
  // record, the second stops a record being answered twice.
  let contractorValue: number;
  let offerId: string;
  let description: string;
  let language: string;
  let contractorName: string;

  if (targetType === "WORK") {
    const w = await prisma.workPeriod.findUnique({
      where: { id: targetId },
      include: {
        offer: {
          select: {
            id: true,
            workerId: true,
            worker: { select: { language: true } },
            contractor: { select: { name: true } },
          },
        },
      },
    });
    if (!w) return { ok: false as const, error: "That record does not exist" };
    if (w.offer.workerId !== workerId) {
      return { ok: false as const, error: "That record is not yours" };
    }
    if (w.confirmState !== "WAITING") {
      return {
        ok: false as const,
        error: `You already answered that record — it is marked ${w.confirmState.toLowerCase()}.`,
      };
    }
    contractorValue = w.days;
    offerId = w.offer.id;
    description = `${w.days} day${w.days === 1 ? "" : "s"} (${w.fromDate.toISOString().slice(0, 10)} to ${w.toDate.toISOString().slice(0, 10)})`;
    language = w.offer.worker.language;
    contractorName = w.offer.contractor.name;
  } else {
    const p = await prisma.payment.findUnique({
      where: { id: targetId },
      include: {
        offer: {
          select: {
            id: true,
            workerId: true,
            worker: { select: { language: true } },
            contractor: { select: { name: true } },
          },
        },
      },
    });
    if (!p) return { ok: false as const, error: "That record does not exist" };
    if (p.offer.workerId !== workerId) {
      return { ok: false as const, error: "That record is not yours" };
    }
    if (p.confirmState !== "WAITING") {
      return {
        ok: false as const,
        error: `You already answered that record — it is marked ${p.confirmState.toLowerCase()}.`,
      };
    }
    contractorValue = p.amount;
    offerId = p.offer.id;
    description = `payment of Rs ${p.amount.toFixed(0)} on ${p.paidOn.toISOString().slice(0, 10)}`;
    language = p.offer.worker.language;
    contractorName = p.offer.contractor.name;
  }

  const confirmed = decision === "CONFIRM";
  const workerValue = confirmed ? contractorValue : (input.workerValue ?? 0);

  // Update the record and seal the worker's answer in one transaction, so a
  // confirmation can never exist without its chain entry or the reverse.
  const result = await prisma.$transaction(async (tx) => {
    if (targetType === "WORK") {
      await tx.workPeriod.update({
        where: { id: targetId },
        data: {
          confirmState: confirmed ? "CONFIRMED" : "DISPUTED",
          confirmedAt: respondedAt,
          confirmedVia: via,
          workerClaimsDays: confirmed ? null : workerValue,
          disputeNote: confirmed ? null : input.note?.trim() || null,
        },
      });
    } else {
      await tx.payment.update({
        where: { id: targetId },
        data: {
          confirmState: confirmed ? "CONFIRMED" : "DISPUTED",
          confirmedAt: respondedAt,
          confirmedVia: via,
          workerClaimsAmount: confirmed ? null : workerValue,
          disputeNote: confirmed ? null : input.note?.trim() || null,
        },
      });
    }

    // The composite id lets one chain entry refer into either table.
    const recordId = `${targetType}:${targetId}`;

    const link = confirmed
      ? await appendToChain(tx, {
          recordType: "CONFIRM",
          recordId,
          workerId,
          summary: `Worker confirmed ${description} is correct (by ${via === "SMS" ? "SMS" : "website"})`,
          payload: {
            type: "CONFIRM",
            targetType,
            targetId,
            workerId,
            value: contractorValue,
            confirmedAt: respondedAt.toISOString(),
            via,
          },
        })
      : await appendToChain(tx, {
          recordType: "DISPUTE",
          recordId,
          workerId,
          summary: `Worker says ${description} is wrong — claims ${targetType === "WORK" ? `${workerValue} days` : `Rs ${workerValue.toFixed(0)}`} (by ${via === "SMS" ? "SMS" : "website"})`,
          payload: {
            type: "DISPUTE",
            targetType,
            targetId,
            workerId,
            contractorValue,
            workerValue,
            note: input.note?.trim() ?? "",
            disputedAt: respondedAt.toISOString(),
            via,
          },
        });

    return link;
  });

  const ref = shortRef(result.currentHash);

  await send({
    userId: workerId,
    kind: confirmed ? "CONFIRMED" : "DISPUTED",
    reference: ref,
    language,
    body: confirmed
      ? confirmedReceipt({ what: description, ref }, language as Language)
      : disputedReceipt({ what: description, ref }, language as Language),
    bodyEn: confirmed
      ? confirmedReceipt({ what: description, ref }, "en")
      : disputedReceipt({ what: description, ref }, "en"),
  });

  const balance = await computeBalance(offerId);

  return {
    ok: true as const,
    confirmed,
    ref,
    description,
    contractorName,
    contractorValue,
    workerValue,
    balance,
  };
}
