import { prisma } from "./prisma";
import type { AuthUser } from "./auth";

/**
 * ===========================================================================
 * Which ledger records a user may see. ADR-0013, docs/contracts/ledger.md.
 * ===========================================================================
 *
 *   - A worker sees the records of contracts where he is the worker.
 *   - A contractor sees the records of contracts where he is the contractor,
 *     and not the same worker's contracts with someone else.
 *   - A labour officer sees every record.
 *
 * Every ledger entry belongs to exactly one contract, but it names that
 * contract in different ways depending on its type, so the contractor's rule
 * is built from each type's own id:
 *
 *   OFFER, ACCEPT      recordId is the offer id
 *   WORK               recordId is the work period id
 *   PAYMENT            recordId is the payment id
 *   CONFIRM, DISPUTE   recordId is "WORK:<id>" or "PAYMENT:<id>"
 *   EMPLOYER_NOTE      recordId is the employer statement id
 *
 * The worker's rule is simpler, because every entry stores the contract's
 * worker in `workerId`, including the contractor's own EMPLOYER_NOTE.
 *
 * This only decides what is shown. It never changes a record, and it never
 * reaches rebuildPayload, which still reads the live row for every entry.
 */

type EntryWhere = NonNullable<NonNullable<Parameters<typeof prisma.ledgerEntry.findMany>[0]>["where"]>;

/** Matches no entry. Used for a role this file does not know. */
const NOTHING: EntryWhere = { recordId: { in: [] } };

/**
 * The filter for the entries `user` may see, or `null` when they may see all.
 */
export async function visibleEntries(user: AuthUser): Promise<EntryWhere | null> {
  if (user.role === "AUTHORITY") return null;
  if (user.role === "WORKER") return { workerId: user.id };
  if (user.role !== "CONTRACTOR") return NOTHING;

  const offers = await prisma.workOffer.findMany({
    where: { contractorId: user.id },
    select: {
      id: true,
      workPeriods: { select: { id: true } },
      payments: { select: { id: true } },
      employerStatements: { select: { id: true } },
    },
  });

  const offerIds = offers.map((o) => o.id);
  const workIds = offers.flatMap((o) => o.workPeriods.map((w) => w.id));
  const paymentIds = offers.flatMap((o) => o.payments.map((p) => p.id));
  const statementIds = offers.flatMap((o) => o.employerStatements.map((s) => s.id));

  return {
    OR: [
      { recordType: { in: ["OFFER", "ACCEPT"] }, recordId: { in: offerIds } },
      { recordType: "WORK", recordId: { in: workIds } },
      { recordType: "PAYMENT", recordId: { in: paymentIds } },
      {
        recordType: { in: ["CONFIRM", "DISPUTE"] },
        recordId: {
          in: [...workIds.map((id) => `WORK:${id}`), ...paymentIds.map((id) => `PAYMENT:${id}`)],
        },
      },
      { recordType: "EMPLOYER_NOTE", recordId: { in: statementIds } },
    ],
  };
}
