import "./setup";
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Closed complaints stay closed. ADR-0023. Contract: docs/contracts/complaints.md.
 *
 * What these tests guarantee:
 * - a complaint that is RESOLVED, REJECTED, CLOSED_UNPROVEN or ESCALATED is
 *   refused by every route that changes a complaint (ask-employer,
 *   employer-reply, contact, decide, escalate) with 409 COMPLAINT_CLOSED;
 * - a refused request writes no case-file entry, leaves the status as it was,
 *   and sends no SMS, so the worker is never told about an action that did
 *   not happen;
 * - an open complaint can still be escalated, and escalating sets closedAt;
 * - after escalation the case cannot be decided.
 *
 * The SMS provider is a fake. No test calls textbee.dev. Rows go into wage_test.
 */

const P = { worker: "9999999991", contractor: "9999999992", officer: "9999999993" };
const CLOSED = ["RESOLVED", "REJECTED", "CLOSED_UNPROVEN", "ESCALATED"] as const;

function listen(app: express.Express): Promise<{ base: string; server: Server }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () =>
      resolve({ base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server }),
    );
  });
}

const sent: string[] = [];

describe("closed complaints stay closed", () => {
  let base = "";
  let server: Server;
  let offerId = "";
  const ids = {} as Record<keyof typeof P, string>;
  const tokens = {} as Record<keyof typeof P, string>;

  before(async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    const { signToken } = await import("../src/lib/auth.js");
    const sms = await import("../src/lib/sms.js");

    sms.setSmsProvider({
      async send({ to, body }) {
        sent.push(`${to}: ${body}`);
        return { id: `fake-${sent.length}`, status: "queued" };
      },
    });

    await prisma.workOffer.deleteMany({ where: { worker: { phone: { in: Object.values(P) } } } });
    await prisma.user.deleteMany({ where: { phone: { in: Object.values(P) } } });
    const roles = { worker: "WORKER", contractor: "CONTRACTOR", officer: "AUTHORITY" } as const;
    for (const key of Object.keys(P) as (keyof typeof P)[]) {
      const u = await prisma.user.create({ data: { phone: P[key], name: `Closed ${key}`, role: roles[key] } });
      ids[key] = u.id;
      tokens[key] = signToken({ id: u.id, name: u.name, phone: u.phone, role: roles[key] });
    }
    const offer = await prisma.workOffer.create({
      data: {
        workerId: ids.worker,
        contractorId: ids.contractor,
        dailyRate: 800,
        workType: "Painting",
        siteName: "Closed test site",
        startDate: new Date("2026-10-01T00:00:00.000Z"),
        expectedDays: 10,
        status: "ACCEPTED",
      },
    });
    offerId = offer.id;

    const { complaintsRouter } = await import("../src/routes/complaints.js");
    const app = express();
    app.use(express.json());
    app.use("/api/complaints", complaintsRouter);
    ({ base, server } = await listen(app));
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    const { prisma } = await import("../src/lib/prisma.js");
    const sms = await import("../src/lib/sms.js");
    sms.setSmsProvider(null);
    await prisma.workOffer.deleteMany({ where: { id: offerId } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    sent.length = 0;
  });

  async function complaint(status: string) {
    const { prisma } = await import("../src/lib/prisma.js");
    return prisma.complaint.create({
      data: {
        offerId,
        raisedById: ids.worker,
        category: "UNPAID",
        description: "Ten days of work and no payment at all.",
        status,
      },
    });
  }

  async function post(path: string, who: keyof typeof P, body: unknown) {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokens[who]}` },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  /** Every route that changes a complaint, with a body that is valid for it. */
  const ROUTES: [string, keyof typeof P, unknown][] = [
    ["ask-employer", "officer", { note: "Please explain the missing payment." }],
    ["employer-reply", "contractor", { note: "I paid him in cash last week." }],
    ["contact", "officer", { kind: "MESSAGED_WORKER", note: "We are looking into this." }],
    ["decide", "officer", { outcome: "UPHELD", note: "The records show he is owed." }],
    ["escalate", "officer", { to: "POLICE", note: "The contractor has stopped answering." }],
  ];

  for (const status of CLOSED) {
    for (const [route, who, body] of ROUTES) {
      it(`refuses ${route} on a ${status} complaint, and writes and sends nothing`, async () => {
        const { prisma } = await import("../src/lib/prisma.js");
        const c = await complaint(status);

        const r = await post(`/api/complaints/${c.id}/${route}`, who, body);

        assert.equal(r.status, 409);
        assert.equal(r.body.code, "COMPLAINT_CLOSED");
        const after = await prisma.complaint.findUniqueOrThrow({ where: { id: c.id }, include: { actions: true } });
        assert.equal(after.status, status, "the status must not change");
        assert.equal(after.actions.length, 0, "no case-file entry may be written");
        assert.deepEqual(sent, [], "no SMS may be sent");
      });
    }
  }

  it("escalates an open complaint and sets the date it was closed", async () => {
    const c = await complaint("OPEN");
    const r = await post(`/api/complaints/${c.id}/escalate`, "officer", {
      to: "LABOUR_COMMISSIONER",
      note: "The amount is beyond what this office can settle.",
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, "ESCALATED");
    assert.ok(r.body.closedAt, "an escalated complaint must have closedAt");
    assert.equal(sent.length, 1, "the worker is told once");
  });

  it("cannot decide a complaint after it was escalated", async () => {
    const c = await complaint("OPEN");
    await post(`/api/complaints/${c.id}/escalate`, "officer", { to: "POLICE", note: "Threats were made to the worker." });
    sent.length = 0;
    const r = await post(`/api/complaints/${c.id}/decide`, "officer", { outcome: "REJECTED", note: "Changed my mind about it." });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "COMPLAINT_CLOSED");
    assert.deepEqual(sent, []);
  });
});
