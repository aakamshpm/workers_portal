import "./setup";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { canonicalPayload } from "../src/lib/hashChain";

/**
 * rebuildPayloads(): the batched rebuild behind verifyLedger().
 *
 * What these tests guarantee:
 *
 *   1. For each of the seven record types it returns exactly the text that was
 *      sealed, built by hand here from the known field values. A drift would
 *      make every untouched record look tampered, or hide a real change.
 *   2. It returns null in every case the single-row rebuildPayload() does:
 *      missing row, ACCEPT on an unanswered offer, CONFIRM/DISPUTE on a row the
 *      worker has not answered, a composite id with no colon or an unknown
 *      table, and an unknown record type. A missing row is tampering, so null
 *      must never turn into "no problem".
 *   3. It reads the LIVE row (current-state.md, invariant 1): changing an
 *      amount after sealing changes the rebuilt text for the payment AND for the
 *      worker's confirmation of it.
 *   4. The number of queries does not grow with the number of records. One
 *      query per record was the reason verification took minutes at 1,00,000
 *      rows (docs/research/results/verify_bench.csv).
 */

const PHONES = { worker: "7100000001", contractor: "7100000002" };

type Entry = { recordType: string; recordId: string };

/** A client that counts every operation, so the tests can see the query count. */
async function countingClient() {
  const { prisma } = await import("../src/lib/prisma.js");
  const counter = { ops: 0 };
  const db = prisma.$extends({
    query: {
      $allOperations({ args, query }) {
        counter.ops += 1;
        return query(args);
      },
    },
  });
  return { db: db as unknown as typeof prisma, counter };
}

describe("rebuildPayloads", () => {
  const ids = {} as Record<string, string>;
  let sealed: Record<string, string> = {};

  before(async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    await prisma.workOffer.deleteMany({ where: { worker: { phone: PHONES.worker } } });
    await prisma.user.deleteMany({ where: { phone: { in: Object.values(PHONES) } } });

    const worker = await prisma.user.create({ data: { phone: PHONES.worker, name: "Rebuild Worker", role: "WORKER" } });
    const contractor = await prisma.user.create({
      data: { phone: PHONES.contractor, name: "Rebuild Contractor", role: "CONTRACTOR" },
    });

    const start = new Date("2026-08-03T00:00:00.000Z");
    const responded = new Date("2026-08-01T09:30:00.000Z");
    const offer = await prisma.workOffer.create({
      data: {
        workerId: worker.id,
        contractorId: contractor.id,
        dailyRate: 850,
        workType: "Construction - steel binding",
        siteName: "Kakkanad Phase 2",
        startDate: start,
        expectedDays: 26,
        extraTerms: "Food provided",
        status: "ACCEPTED",
        respondedAt: responded,
        respondedVia: "SMS",
      },
    });
    const pending = await prisma.workOffer.create({
      data: {
        workerId: worker.id,
        contractorId: contractor.id,
        dailyRate: 700,
        workType: "Painting",
        siteName: "Aluva",
        startDate: start,
        expectedDays: 5,
      },
    });

    const confirmedAt = new Date("2026-08-10T18:00:00.000Z");
    const w1 = await prisma.workPeriod.create({
      data: {
        offerId: offer.id,
        fromDate: new Date("2026-08-03T00:00:00.000Z"),
        toDate: new Date("2026-08-08T00:00:00.000Z"),
        days: 6,
        note: "First week",
        confirmState: "CONFIRMED",
        confirmedAt,
        confirmedVia: "SMS",
      },
    });
    const w2 = await prisma.workPeriod.create({
      data: {
        offerId: offer.id,
        fromDate: new Date("2026-08-10T00:00:00.000Z"),
        toDate: new Date("2026-08-15T00:00:00.000Z"),
        days: 4,
        confirmState: "DISPUTED",
        confirmedAt,
        confirmedVia: "WEB",
        workerClaimsDays: 6,
        disputeNote: "I worked all six days",
      },
    });
    const w3 = await prisma.workPeriod.create({
      data: {
        offerId: offer.id,
        fromDate: new Date("2026-08-17T00:00:00.000Z"),
        toDate: new Date("2026-08-17T00:00:00.000Z"),
        days: 1,
      },
    });
    const paidOn = new Date("2026-08-09T00:00:00.000Z");
    const p1 = await prisma.payment.create({
      data: {
        offerId: offer.id,
        amount: 5100,
        paidOn,
        method: "CASH",
        confirmState: "CONFIRMED",
        confirmedAt,
        confirmedVia: "SMS",
      },
    });
    const p2 = await prisma.payment.create({
      data: {
        offerId: offer.id,
        amount: 3000,
        paidOn,
        method: "UPI",
        note: "Part payment",
        confirmState: "DISPUTED",
        confirmedAt,
        confirmedVia: "SMS",
        workerClaimsAmount: 1500,
        disputeNote: "Only 1500 received",
      },
    });
    const statement = await prisma.employerStatement.create({
      data: {
        targetType: "PAYMENT",
        targetId: p2.id,
        offerId: offer.id,
        contractorId: contractor.id,
        note: "UPI reference given to the officer",
      },
    });

    Object.assign(ids, {
      worker: worker.id,
      contractor: contractor.id,
      offer: offer.id,
      pending: pending.id,
      w1: w1.id,
      w2: w2.id,
      w3: w3.id,
      p1: p1.id,
      p2: p2.id,
      statement: statement.id,
    });

    // The text each record was sealed with, written out field by field.
    sealed = {
      [`OFFER ${offer.id}`]: canonicalPayload({
        type: "OFFER",
        workerId: worker.id,
        contractorId: contractor.id,
        dailyRate: 850,
        workType: "Construction - steel binding",
        siteName: "Kakkanad Phase 2",
        startDate: start.toISOString(),
        expectedDays: 26,
        extraTerms: "Food provided",
      }),
      [`ACCEPT ${offer.id}`]: canonicalPayload({
        type: "ACCEPT",
        offerId: offer.id,
        workerId: worker.id,
        dailyRate: 850,
        workType: "Construction - steel binding",
        siteName: "Kakkanad Phase 2",
        acceptedAt: responded.toISOString(),
        via: "SMS",
      }),
      [`WORK ${w1.id}`]: canonicalPayload({
        type: "WORK",
        offerId: offer.id,
        workerId: worker.id,
        fromDate: "2026-08-03T00:00:00.000Z",
        toDate: "2026-08-08T00:00:00.000Z",
        days: 6,
        note: "First week",
      }),
      [`WORK ${w2.id}`]: canonicalPayload({
        type: "WORK",
        offerId: offer.id,
        workerId: worker.id,
        fromDate: "2026-08-10T00:00:00.000Z",
        toDate: "2026-08-15T00:00:00.000Z",
        days: 4,
        note: "",
      }),
      [`PAYMENT ${p1.id}`]: canonicalPayload({
        type: "PAYMENT",
        offerId: offer.id,
        workerId: worker.id,
        amount: 5100,
        paidOn: paidOn.toISOString(),
        method: "CASH",
        note: "",
      }),
      [`PAYMENT ${p2.id}`]: canonicalPayload({
        type: "PAYMENT",
        offerId: offer.id,
        workerId: worker.id,
        amount: 3000,
        paidOn: paidOn.toISOString(),
        method: "UPI",
        note: "Part payment",
      }),
      [`CONFIRM WORK:${w1.id}`]: canonicalPayload({
        type: "CONFIRM",
        targetType: "WORK",
        targetId: w1.id,
        workerId: worker.id,
        value: 6,
        confirmedAt: confirmedAt.toISOString(),
        via: "SMS",
      }),
      [`DISPUTE WORK:${w2.id}`]: canonicalPayload({
        type: "DISPUTE",
        targetType: "WORK",
        targetId: w2.id,
        workerId: worker.id,
        contractorValue: 4,
        workerValue: 6,
        note: "I worked all six days",
        disputedAt: confirmedAt.toISOString(),
        via: "WEB",
      }),
      [`CONFIRM PAYMENT:${p1.id}`]: canonicalPayload({
        type: "CONFIRM",
        targetType: "PAYMENT",
        targetId: p1.id,
        workerId: worker.id,
        value: 5100,
        confirmedAt: confirmedAt.toISOString(),
        via: "SMS",
      }),
      [`DISPUTE PAYMENT:${p2.id}`]: canonicalPayload({
        type: "DISPUTE",
        targetType: "PAYMENT",
        targetId: p2.id,
        workerId: worker.id,
        contractorValue: 3000,
        workerValue: 1500,
        note: "Only 1500 received",
        disputedAt: confirmedAt.toISOString(),
        via: "SMS",
      }),
      [`EMPLOYER_NOTE ${statement.id}`]: canonicalPayload({
        type: "EMPLOYER_NOTE",
        targetType: "PAYMENT",
        targetId: p2.id,
        contractorId: contractor.id,
        note: "UPI reference given to the officer",
        writtenAt: statement.createdAt.toISOString(),
      }),
    };
  });

  after(async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    await prisma.workOffer.deleteMany({ where: { worker: { phone: PHONES.worker } } });
    await prisma.user.deleteMany({ where: { phone: { in: Object.values(PHONES) } } });
  });

  const asEntries = (keys: string[]): Entry[] =>
    keys.map((k) => {
      const [recordType, recordId] = k.split(" ") as [string, string];
      return { recordType, recordId };
    });

  it("rebuilds every record type to exactly the sealed text, in the order given", async () => {
    const { rebuildPayloads } = await import("../src/lib/ledger.js");
    const keys = Object.keys(sealed);
    assert.equal(new Set(keys.map((k) => k.split(" ")[0])).size, 7, "all seven types are covered");

    // Reversed and with a repeat, so the answer must follow the input order.
    const order = [...keys].reverse().concat(keys[0]!);
    const got = await rebuildPayloads(asEntries(order));
    assert.deepEqual(got, order.map((k) => sealed[k]));
  });

  it("returns null exactly where the single-row rebuild does", async () => {
    const { rebuildPayloads, rebuildPayload } = await import("../src/lib/ledger.js");
    const cases: [string, Entry][] = [
      ["offer row deleted", { recordType: "OFFER", recordId: "missing-offer" }],
      ["accept on an unanswered offer", { recordType: "ACCEPT", recordId: ids.pending! }],
      ["work row deleted", { recordType: "WORK", recordId: "missing-work" }],
      ["payment row deleted", { recordType: "PAYMENT", recordId: "missing-payment" }],
      ["confirm on an unanswered work row", { recordType: "CONFIRM", recordId: `WORK:${ids.w3}` }],
      ["dispute on a deleted payment", { recordType: "DISPUTE", recordId: "PAYMENT:missing-payment" }],
      ["composite id with no colon", { recordType: "CONFIRM", recordId: `WORK${ids.w1}` }],
      ["composite id for an unknown table", { recordType: "CONFIRM", recordId: `OFFER:${ids.offer}` }],
      ["statement row deleted", { recordType: "EMPLOYER_NOTE", recordId: "missing-statement" }],
      ["unknown record type", { recordType: "BONUS", recordId: ids.p1! }],
    ];
    const got = await rebuildPayloads(cases.map(([, e]) => e));
    for (const [i, [name, e]] of cases.entries()) {
      assert.equal(got[i], null, name);
      assert.equal(await rebuildPayload(e.recordType, e.recordId), null, `${name} (single row)`);
    }
  });

  it("reads the live row: a changed amount changes the payment and its confirmation", async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    const { rebuildPayloads } = await import("../src/lib/ledger.js");
    const keys = [`PAYMENT ${ids.p1}`, `CONFIRM PAYMENT:${ids.p1}`, `OFFER ${ids.offer}`];

    await prisma.payment.update({ where: { id: ids.p1 }, data: { amount: 1 } });
    try {
      const got = await rebuildPayloads(asEntries(keys));
      assert.notEqual(got[0], sealed[keys[0]!], "the payment must no longer match");
      assert.notEqual(got[1], sealed[keys[1]!], "the worker's confirmation must no longer match");
      assert.equal(got[2], sealed[keys[2]!], "an untouched record still matches");
      assert.match(got[0]!, /\|1\.00\|/, "the rebuilt text carries the live amount");
    } finally {
      await prisma.payment.update({ where: { id: ids.p1 }, data: { amount: 5100 } });
    }
  });

  it("uses at most one query per table, however many records are rebuilt", async () => {
    const { rebuildPayloads } = await import("../src/lib/ledger.js");
    const { db, counter } = await countingClient();

    // 110 records: every real one ten times over, plus missing ones.
    const many = Array.from({ length: 10 }, () => asEntries(Object.keys(sealed))).flat();
    many.push(...Array.from({ length: 50 }, (_, i) => ({ recordType: "PAYMENT", recordId: `missing-${i}` })));

    const got = await rebuildPayloads(many, db);
    assert.equal(got.length, many.length);
    assert.ok(counter.ops <= 4, `expected at most 4 queries (offers, work, payments, statements), got ${counter.ops}`);
  });

  it("splits a very long id list into chunks, and loses no id at a chunk edge", async () => {
    const { rebuildPayloads, ID_CHUNK } = await import("../src/lib/ledger.js");
    const { db, counter } = await countingClient();

    // Real ids at the last place of chunk 1, the first of chunk 2, and the very
    // end, so an off-by-one in the chunking drops one of them.
    const total = ID_CHUNK * 2 + 500;
    const many: Entry[] = Array.from({ length: total }, (_, i) => ({ recordType: "PAYMENT", recordId: `none-${i}` }));
    const real = { [ID_CHUNK - 1]: ids.p1!, [ID_CHUNK]: ids.p2!, [total - 1]: ids.w1! };
    for (const [at, id] of Object.entries(real)) {
      many[Number(at)] = { recordType: id === ids.w1 ? "WORK" : "PAYMENT", recordId: id };
    }

    const got = await rebuildPayloads(many, db);
    assert.equal(got[ID_CHUNK - 1], sealed[`PAYMENT ${ids.p1}`], "last id of the first chunk");
    assert.equal(got[ID_CHUNK], sealed[`PAYMENT ${ids.p2}`], "first id of the second chunk");
    assert.equal(got[total - 1], sealed[`WORK ${ids.w1}`], "last id");
    assert.equal(got.filter((g) => g !== null).length, 3);
    assert.ok(counter.ops >= 3 && counter.ops <= 5, `expected a few chunked queries, got ${counter.ops}`);
  });

  it("verifyLedger reads the ledger and the live rows with a fixed number of queries", async () => {
    const { verifyLedger } = await import("../src/lib/ledger.js");
    const { db, counter } = await countingClient();
    const result = await verifyLedger(db);
    assert.ok(result.entriesChecked > 0, "the test database has ledger rows from the other tests");
    assert.ok(counter.ops >= 1, "verifyLedger must read through the client it is given");
    assert.ok(counter.ops <= 5, `expected at most 5 queries (ledger + 4 tables), got ${counter.ops}`);
  });
});
