import "./setup";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";

/**
 * Inbound SMS must APPLY the worker's reply, not only store it.
 *
 * Contract (docs/project/plan.md, phase 2 item 4 and phase 1 item 3):
 * a worker replies YES from their own Messages app and the offer is accepted.
 * The 30s Textbee poll is the only path for a real handset, so the poll must
 * run the same accept logic the website uses.
 *
 * Failure mode this protects: the poll stores the row and nothing else, so a
 * real YES never locks the terms and the worker's acceptance is never sealed.
 */

if (!process.env.HMAC_SECRET) process.env.HMAC_SECRET = "test-key-for-hmac-swap";

const WORKER_PHONE = "9999999921";
const CONTRACTOR_PHONE = "9999999922";

describe("inbound sms applies the reply", () => {
  let workerId = "";
  let contractorId = "";
  let offerId = "";
  let ref = "";

  before(async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    const sms = await import("../src/lib/sms.js");
    const pin = await bcrypt.hash("1234", 10);

    await prisma.smsMessage.deleteMany({
      where: { user: { phone: { in: [WORKER_PHONE, CONTRACTOR_PHONE] } } },
    });
    await prisma.workOffer.deleteMany({
      where: { worker: { phone: WORKER_PHONE } },
    });
    await prisma.user.deleteMany({
      where: { phone: { in: [WORKER_PHONE, CONTRACTOR_PHONE] } },
    });

    const worker = await prisma.user.create({
      data: { phone: WORKER_PHONE, name: "Inbound Worker", role: "WORKER", pin, language: "en" },
    });
    const contractor = await prisma.user.create({
      data: {
        phone: CONTRACTOR_PHONE,
        name: "Inbound Contractor",
        role: "CONTRACTOR",
        pin,
        company: "Inbound Builders",
      },
    });
    workerId = worker.id;
    contractorId = contractor.id;

    // Fake provider so the offer SMS never calls textbee.dev.
    sms.setSmsProvider({
      async send() {
        return { id: "fake-out", status: "queued" };
      },
      async fetchInbound() {
        return [];
      },
    });

    const { appendToChain } = await import("../src/lib/ledger.js");
    const created = await prisma.$transaction(async (tx) => {
      const offer = await tx.workOffer.create({
        data: {
          workerId: worker.id,
          contractorId: contractor.id,
          dailyRate: 900,
          workType: "Painting",
          siteName: "Test Site",
          startDate: new Date("2026-10-01T00:00:00.000Z"),
          expectedDays: 10,
          status: "PENDING",
        },
      });
      const link = await appendToChain(tx, {
        recordType: "OFFER",
        recordId: offer.id,
        workerId: worker.id,
        summary: "Offer sent: Rs 900.00/day, Painting, Test Site",
        payload: {
          type: "OFFER",
          workerId: worker.id,
          contractorId: contractor.id,
          dailyRate: 900,
          workType: "Painting",
          siteName: "Test Site",
          startDate: new Date("2026-10-01T00:00:00.000Z").toISOString(),
          expectedDays: 10,
          extraTerms: "",
        },
      });
      return { offer, link };
    });

    offerId = created.offer.id;
    ref = sms.shortRef(created.link.currentHash);
    await prisma.$disconnect();
  });

  after(async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    const sms = await import("../src/lib/sms.js");
    sms.setSmsProvider(null);
    await prisma.smsMessage.deleteMany({ where: { userId: { in: [workerId, contractorId] } } });
    await prisma.workOffer.deleteMany({ where: { workerId } });
    await prisma.user.deleteMany({ where: { id: { in: [workerId, contractorId] } } });
    await prisma.$disconnect();
  });

  it("accepts the offer when the handset replies YES <ref>", async () => {
    const sms = await import("../src/lib/sms.js");
    const { pollAndApplyInbound } = await import("../src/lib/inbound.js");
    const { prisma } = await import("../src/lib/prisma.js");

    sms.setSmsProvider({
      async send() {
        return { id: "fake-out", status: "queued" };
      },
      async fetchInbound() {
        return [
          {
            from: `+91${WORKER_PHONE}`,
            body: `YES ${ref}`,
            receivedAt: new Date().toISOString(),
          },
        ];
      },
    });

    const applied = await pollAndApplyInbound();
    assert.equal(applied, 1, "one reply must be applied");

    const offer = await prisma.workOffer.findUniqueOrThrow({ where: { id: offerId } });
    assert.equal(offer.status, "ACCEPTED", "a real YES must accept the offer");
    assert.equal(offer.respondedVia, "SMS");
    assert.ok(offer.respondedAt !== null);

    const accept = await prisma.ledgerEntry.findFirst({
      where: { recordType: "ACCEPT", recordId: offerId },
    });
    assert.ok(accept, "the worker's acceptance must be sealed in the chain");

    const inbound = await prisma.smsMessage.findFirst({
      where: { userId: workerId, direction: "IN" },
    });
    assert.ok(inbound, "the reply must still be stored as an audit row");
    await prisma.$disconnect();
  });

  it("does not apply the same reply twice", async () => {
    const { pollAndApplyInbound } = await import("../src/lib/inbound.js");
    // Same fake inbound is still returned, but the offer is no longer PENDING.
    const applied = await pollAndApplyInbound();
    assert.equal(applied, 0, "an already answered offer must not be answered again");
  });

  it("treats a repeated body as a new message when the provider id differs", async () => {
    /**
     * The failure this protects, found on a real handset:
     *
     * the worker replied "YES 5804", the poll stored it but did not apply it,
     * so he sent the identical text again. Dedupe by body text then skipped the
     * second message, because a row with that body already existed, and the
     * offer stayed PENDING for ever. Two identical bodies are two real
     * messages, so dedupe must use the provider's own message id.
     */
    const sms = await import("../src/lib/sms.js");
    const { pollAndApplyInbound } = await import("../src/lib/inbound.js");
    const { prisma } = await import("../src/lib/prisma.js");

    // A second offer, so there is something a repeated YES can act on.
    const { appendToChain } = await import("../src/lib/ledger.js");
    const second = await prisma.$transaction(async (tx) => {
      const offer = await tx.workOffer.create({
        data: {
          workerId,
          contractorId,
          dailyRate: 800,
          workType: "Painting",
          siteName: "Second Site",
          startDate: new Date("2026-11-01T00:00:00.000Z"),
          expectedDays: 8,
          status: "PENDING",
        },
      });
      const link = await appendToChain(tx, {
        recordType: "OFFER",
        recordId: offer.id,
        workerId,
        summary: "Offer sent: Rs 800.00/day, Painting, Second Site",
        payload: {
          type: "OFFER",
          workerId,
          contractorId,
          dailyRate: 800,
          workType: "Painting",
          siteName: "Second Site",
          startDate: new Date("2026-11-01T00:00:00.000Z").toISOString(),
          expectedDays: 8,
          extraTerms: "",
        },
      });
      return { offer, link };
    });

    const secondRef = sms.shortRef(second.link.currentHash);
    const body = `YES ${secondRef}`;

    // First arrival, provider id A.
    sms.setSmsProvider({
      async send() {
        return { id: "fake-out", status: "queued" };
      },
      async fetchInbound() {
        return [
          {
            id: "provider-msg-A",
            from: `+91${WORKER_PHONE}`,
            body,
            receivedAt: new Date().toISOString(),
          },
        ];
      },
    });
    assert.equal(await pollAndApplyInbound(), 1, "first arrival must be applied");

    // Identical text, different provider id. Must be treated as a new message
    // and stored, even though the offer it named is already answered.
    sms.setSmsProvider({
      async send() {
        return { id: "fake-out", status: "queued" };
      },
      async fetchInbound() {
        return [
          {
            id: "provider-msg-B",
            from: `+91${WORKER_PHONE}`,
            body,
            receivedAt: new Date().toISOString(),
          },
        ];
      },
    });
    await pollAndApplyInbound();

    const stored = await prisma.smsMessage.findMany({
      where: { userId: workerId, direction: "IN", body },
    });
    assert.equal(stored.length, 2, "both arrivals must be stored as separate audit rows");

    // The same provider id must never be stored twice.
    await pollAndApplyInbound();
    const again = await prisma.smsMessage.findMany({
      where: { userId: workerId, direction: "IN", body },
    });
    assert.equal(again.length, 2, "a repeated provider id must be skipped");

    await prisma.$disconnect();
  });
});
