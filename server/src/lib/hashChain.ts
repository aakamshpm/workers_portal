import { createHmac } from "node:crypto";

/**
 * ===========================================================================
 * The tamper-evidence layer.
 *
 * One job: make it impossible to change a past record without the change being
 * detectable. This is a supporting mechanism, not the point of the project - the
 * point is that a worker can prove what was agreed and what they are owed. This
 * is what makes that proof hold.
 * ===========================================================================
 */

/** The chain has to start somewhere. Record 0 follows on from this fixed value. */
export const GENESIS_HASH = "0";

export type RecordType =
  | "OFFER"
  | "ACCEPT"
  | "WORK"
  | "PAYMENT"
  | "CONFIRM"
  | "DISPUTE"
  | "EMPLOYER_NOTE";

/**
 * The four kinds of event that get sealed, and exactly which fields of each are
 * protected.
 *
 * Anything listed here cannot change without breaking the chain. Anything absent
 * is deliberately outside the seal - most importantly complaints, which are
 * raised later and must not invalidate the record they complain about.
 */
export type SealedPayload =
  | {
      type: "OFFER";
      workerId: string;
      contractorId: string;
      dailyRate: number;
      workType: string;
      siteName: string;
      startDate: string;
      expectedDays: number;
      extraTerms: string;
    }
  | {
      /**
       * The worker's acceptance.
       *
       * This is the most important record in the system. It repeats the rate and
       * the terms rather than just pointing at the offer, so the sealed text
       * itself is the proof: "this worker agreed to exactly these figures at
       * this moment". A contractor cannot later claim different terms were
       * agreed, because the worker's own YES is sealed against these numbers.
       */
      type: "ACCEPT";
      offerId: string;
      workerId: string;
      dailyRate: number;
      workType: string;
      siteName: string;
      acceptedAt: string;
      via: string;
    }
  | {
      type: "WORK";
      offerId: string;
      workerId: string;
      fromDate: string;
      toDate: string;
      days: number;
      note: string;
    }
  | {
      type: "PAYMENT";
      offerId: string;
      workerId: string;
      amount: number;
      paidOn: string;
      method: string;
      note: string;
    }
  | {
      /**
       * The worker agreeing that a work or payment record is correct.
       *
       * Sealed as its own record rather than as a flag on the original, because
       * it is a separate statement made at a separate time by a different
       * person. It repeats the figure being confirmed, so the sealed text is
       * self-contained proof: "this worker agreed that these 6 days are right".
       */
      type: "CONFIRM";
      targetType: string; // WORK | PAYMENT
      targetId: string;
      workerId: string;
      /** The number the worker is agreeing to: days for WORK, rupees for PAYMENT. */
      value: number;
      confirmedAt: string;
      via: string;
    }
  | {
      /**
       * The worker rejecting a record, with their own figure.
       *
       * Both numbers are sealed - what the contractor wrote and what the worker
       * says - because the disagreement itself is the evidence a labour officer
       * needs. Neither side can later revise their claim.
       */
      type: "DISPUTE";
      targetType: string; // WORK | PAYMENT
      targetId: string;
      workerId: string;
      contractorValue: number;
      workerValue: number;
      note: string;
      disputedAt: string;
      via: string;
    }
  | {
      /**
       * The contractor's answer to a record the worker rejected.
       *
       * Sealed for the same reason the worker's DISPUTE is sealed: it is a
       * statement made at a known moment by a named person, and a labour officer
       * will read it as evidence. Sealing it means the contractor cannot revise
       * his account later, once he knows which way the case is going.
       *
       * It carries no figure of its own. Changing a number is exactly what this
       * record must not be able to do, so there is nothing here for a contractor
       * to move: only his words, the record they answer, and when he wrote them.
       */
      type: "EMPLOYER_NOTE";
      targetType: string; // WORK | PAYMENT
      targetId: string;
      contractorId: string;
      note: string;
      writtenAt: string;
    };

/**
 * Turn a payload into the exact string that gets hashed.
 *
 * Two rules, both learned from real failures:
 *
 * 1. The output must be reproducible byte for byte. Money always renders with two
 *    decimals and dates always as full ISO strings, so a record nobody touched
 *    cannot fail the check just because the database handed back a string where
 *    JavaScript had a Date.
 *
 * 2. Fields are joined with "|", which cannot appear in a generated id or a
 *    formatted number. Without a separator, a rate of 7 with 100 days would seal
 *    identically to a rate of 71 with 00 days.
 */
export function canonicalPayload(p: SealedPayload): string {
  const money = (n: number) => n.toFixed(2);
  const days = (n: number) => n.toFixed(2);

  switch (p.type) {
    case "OFFER":
      return [
        "OFFER",
        p.workerId,
        p.contractorId,
        money(p.dailyRate),
        p.workType,
        p.siteName,
        p.startDate,
        String(p.expectedDays),
        p.extraTerms,
      ].join("|");

    case "ACCEPT":
      return [
        "ACCEPT",
        p.offerId,
        p.workerId,
        money(p.dailyRate),
        p.workType,
        p.siteName,
        p.acceptedAt,
        p.via,
      ].join("|");

    case "WORK":
      return [
        "WORK",
        p.offerId,
        p.workerId,
        p.fromDate,
        p.toDate,
        days(p.days),
        p.note,
      ].join("|");

    case "PAYMENT":
      return [
        "PAYMENT",
        p.offerId,
        p.workerId,
        money(p.amount),
        p.paidOn,
        p.method,
        p.note,
      ].join("|");

    case "CONFIRM":
      return [
        "CONFIRM",
        p.targetType,
        p.targetId,
        p.workerId,
        money(p.value),
        p.confirmedAt,
        p.via,
      ].join("|");

    case "DISPUTE":
      return [
        "DISPUTE",
        p.targetType,
        p.targetId,
        p.workerId,
        money(p.contractorValue),
        money(p.workerValue),
        p.note,
        p.disputedAt,
        p.via,
      ].join("|");

    case "EMPLOYER_NOTE":
      return [
        "EMPLOYER_NOTE",
        p.targetType,
        p.targetId,
        p.contractorId,
        p.note,
        p.writtenAt,
      ].join("|");
  }
}

/**
 * The code for one record: the previous record's code plus this record's own
 * sealed content.
 *
 * Including the previous code in the input is what makes this a chain rather than
 * a set of independent checksums. Each code depends on every record before it, so
 * one edit cannot be contained - it breaks the link at that point and every link
 * after it.
 *
 * ADR-0004: HMAC-SHA-256 with HMAC_SECRET, not plain SHA-256. Anyone who knows
 * the field layout can compute a plain hash from the database alone, so the key
 * lives on the server, never in the database. Tests set the same key through
 * the environment. Missing key fails, never uses an empty key.
 */
export function getHmacSecret(): string {
  const s = process.env.HMAC_SECRET;
  if (!s) {
    throw new Error("HMAC_SECRET is not set. Set it in server/.env");
  }
  return s;
}

export function computeHash(previousHash: string, payload: string): string {
  return createHmac("sha256", getHmacSecret())
    .update(`${previousHash}|${payload}`, "utf8")
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Checking
// ---------------------------------------------------------------------------

export interface StoredLink {
  id: string;
  chainIndex: number;
  recordType: string;
  recordId: string;
  summary: string;

  /** The payload as it was when sealed. Kept as evidence of the original values. */
  payload: string;

  /**
   * The payload rebuilt from the live database row, just before checking.
   *
   * This field is what makes the check meaningful. Hashing the stored `payload`
   * would only prove the ledger row agrees with itself; comparing against a
   * payload rebuilt from the actual WorkOffer / WorkPeriod / Payment row is what
   * detects a change to those rows.
   *
   * null means the underlying record no longer exists, which is itself tampering
   * - the ledger is append-only and has no delete path.
   */
  currentPayload: string | null;

  previousHash: string;
  currentHash: string;
}

export type ChainProblem =
  /** The live record no longer matches the code stored for it. */
  | "HASH_MISMATCH"
  /** This record does not follow on from the previous one. */
  | "BROKEN_LINK"
  /** Record numbers are not a gap-free sequence from 0, so a row was removed. */
  | "INDEX_GAP"
  /** The record this entry sealed has been deleted outright. */
  | "RECORD_MISSING";

export interface ChainFailure {
  chainIndex: number;
  entryId: string;
  recordType: string;
  summary: string;
  problem: ChainProblem;
  expected: string;
  found: string;
  detail: string;

  /** On HASH_MISMATCH: what changed, in words a non-programmer can read. */
  changedFields?: { field: string; original: string; current: string }[];
}

export interface VerificationResult {
  valid: boolean;
  entriesChecked: number;
  failures: ChainFailure[];
  checkedAt: string;
}

/**
 * Rebuild the whole chain and compare it against what is stored. This is what the
 * "Check all records" button calls.
 *
 * `links` must be ordered by ascending chainIndex.
 *
 * Two independent things can be wrong, and they are checked separately so each
 * reported failure means exactly one thing:
 *
 *   HASH_MISMATCH - this record's contents no longer match its stored code, so
 *                   the record was edited. A statement about one row.
 *
 *   BROKEN_LINK   - this record's stored "follows on from" value is not the
 *                   previous record's code, so the sequence was cut, reordered,
 *                   or an earlier record was rewritten.
 *
 * Keeping them apart is what stops untouched rows being blamed. An earlier
 * version recomputed each row from the checker's own running code; when a
 * predecessor was rewritten, the untouched NEXT row also reported HASH_MISMATCH,
 * claiming a row was modified when it was not.
 */
export function verifyChain(links: StoredLink[]): VerificationResult {
  const failures: ChainFailure[] = [];

  links.forEach((link, position) => {
    const base = {
      chainIndex: link.chainIndex,
      entryId: link.id,
      recordType: link.recordType,
      summary: link.summary,
    };

    // The ledger is append-only, so numbers must run 0,1,2,... with no holes.
    if (link.chainIndex !== position) {
      failures.push({
        ...base,
        problem: "INDEX_GAP",
        expected: String(position),
        found: String(link.chainIndex),
        detail: `Expected record ${position} at this position but found ${link.chainIndex}. A record was deleted or reordered.`,
      });
    }

    // --- Check 1: does the live record still match its stored code? ---------
    //
    // The payload is rebuilt from the actual database row, NOT read from the
    // ledger's own copy. Hashing the ledger's copy would only prove the ledger
    // agrees with itself, and a change to the live record would go undetected.
    if (link.currentPayload === null) {
      failures.push({
        ...base,
        problem: "RECORD_MISSING",
        expected: link.payload,
        found: "(record deleted)",
        detail: `Record ${link.chainIndex} covered something that no longer exists in the database. Records can be added but never deleted, so this should be impossible.`,
      });
    } else {
      const recomputed = computeHash(link.previousHash, link.currentPayload);

      if (recomputed !== link.currentHash) {
        const changedFields = diffPayloads(link.payload, link.currentPayload);
        const changeSummary = changedFields
          .map((c) => `${c.field} was ${c.original}, database now says ${c.current}`)
          .join("; ");

        failures.push({
          ...base,
          problem: "HASH_MISMATCH",
          expected: recomputed,
          found: link.currentHash,
          detail:
            `Record ${link.chainIndex} was changed after it was created.` +
            (changeSummary ? ` ${changeSummary}.` : ""),
          changedFields,
        });
      }
    }

    // --- Check 2: does this record follow on from the previous one? ---------
    const expectedLink = position === 0 ? GENESIS_HASH : links[position - 1]!.currentHash;

    if (link.previousHash !== expectedLink) {
      failures.push({
        ...base,
        problem: "BROKEN_LINK",
        expected: expectedLink,
        found: link.previousHash,
        detail:
          position === 0
            ? `The first record must follow on from "${GENESIS_HASH}" but does not.`
            : `Record ${link.chainIndex} no longer follows on from record ${links[position - 1]!.chainIndex}. Either that earlier record was rewritten or a record was removed from between them.`,
      });
    }
  });

  return {
    valid: failures.length === 0,
    entriesChecked: links.length,
    failures,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Field names for each payload position, so a mismatch is reported in plain
 * language rather than as two 64-character codes.
 *
 * These arrays must stay in step with `canonicalPayload`. They are only used for
 * the readable report, so drift here cannot weaken detection - it would produce a
 * vaguer message, not a missed change.
 */
const PAYLOAD_FIELDS: Record<string, string[]> = {
  OFFER: [
    "type",
    "workerId",
    "contractorId",
    "agreed daily rate",
    "type of work",
    "site",
    "start date",
    "expected days",
    "extra terms",
  ],
  ACCEPT: [
    "type",
    "offerId",
    "workerId",
    "rate the worker agreed to",
    "type of work",
    "site",
    "time of acceptance",
    "how they replied",
  ],
  WORK: ["type", "offerId", "workerId", "from date", "to date", "days worked", "note"],
  PAYMENT: ["type", "offerId", "workerId", "amount paid", "date paid", "method", "note"],
  CONFIRM: [
    "type",
    "what was confirmed",
    "targetId",
    "workerId",
    "figure the worker agreed to",
    "time of confirmation",
    "how they replied",
  ],
  DISPUTE: [
    "type",
    "what was disputed",
    "targetId",
    "workerId",
    "figure the contractor recorded",
    "figure the worker says is right",
    "note",
    "time of dispute",
    "how they replied",
  ],
};

/**
 * Compare the original sealed payload against the current one, position by
 * position, and name what differs.
 *
 * Both strings came from `canonicalPayload`, so they have the same field order and
 * separator. Comparing by position is therefore reliable.
 */
function diffPayloads(original: string, current: string) {
  const a = original.split("|");
  const b = current.split("|");
  const names = PAYLOAD_FIELDS[a[0] ?? ""] ?? [];
  const changed: { field: string; original: string; current: string }[] = [];

  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      changed.push({
        field: names[i] ?? `field ${i}`,
        original: a[i] ?? "(absent)",
        current: b[i] ?? "(absent)",
      });
    }
  }

  // Internal ids mean nothing to a human reader; hide them unless they are the
  // only thing that changed.
  const meaningful = changed.filter((c) => !c.field.endsWith("Id"));
  return meaningful.length > 0 ? meaningful : changed;
}
