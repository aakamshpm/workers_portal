import "./setup";
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * The cash handover code. ADR-0024. Contract: docs/contracts/payments.md.
 *
 * What these tests guarantee:
 * - a wrong code is refused with 400 CODE_WRONG and says how many tries are left;
 * - the fifth wrong code spends the code (409 CODE_SPENT), and after that even
 *   the right code records nothing, so a contractor cannot try all 9,000 codes;
 * - a spent code is no longer shown as waiting;
 * - the right code within five tries records the payment;
 * - two requests with the right code at the same moment record one payment;
 * - an expired code is refused with 409 CODE_EXPIRED, and no code at all with
 *   404 NO_CODE;
 * - the code does not come from Math.random.
 *
 * The SMS provider is a fake. The test reads the code from the fake SMS, as the
 * worker would read it from his phone. No test calls textbee.dev. Rows go into
 * wage_test.
 */

const P = { worker: "9999999994", contractor: "9999999995" };

function listen(app: express.Express): Promise<{ base: string; server: Server }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () =>
      resolve({ base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server }),
    );
  });
}

const sent: string[] = [];

describe("cash handover code", () => {
  let base = "";
  let server: Server;
  let offerId = "";
  let token = "";
  const ids = {} as Record<keyof typeof P, string>;

  before(async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    const { signToken } = await import("../src/lib/auth.js");
    const sms = await import("../src/lib/sms.js");

    sms.setSmsProvider({
      async send({ body }) {
        sent.push(body);
        return { id: `fake-${sent.length}`, status: "queued" };
      },
    });

    await prisma.workOffer.deleteMany({ where: { worker: { phone: { in: Object.values(P) } } } });
    await prisma.user.deleteMany({ where: { phone: { in: Object.values(P) } } });
    const w = await prisma.user.create({ data: { phone: P.worker, name: "Handover Worker", role: "WORKER" } });
    const c = await prisma.user.create({ data: { phone: P.contractor, name: "Handover Contractor", role: "CONTRACTOR" } });
    ids.worker = w.id;
    ids.contractor = c.id;
    token = signToken({ id: c.id, name: c.name, phone: c.phone, role: "CONTRACTOR" });

    const offer = await prisma.workOffer.create({
      data: {
        workerId: w.id,
        contractorId: c.id,
        dailyRate: 800,
        workType: "Painting",
        siteName: "Handover test site",
        startDate: new Date("2026-10-01T00:00:00.000Z"),
        expectedDays: 10,
        status: "ACCEPTED",
      },
    });
    offerId = offer.id;

    const { paymentsRouter } = await import("../src/routes/payments.js");
    const app = express();
    app.use(express.json());
    app.use("/api/payments", paymentsRouter);
    ({ base, server } = await listen(app));
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    const { prisma } = await import("../src/lib/prisma.js");
    const sms = await import("../src/lib/sms.js");
    sms.setSmsProvider(null);
    await prisma.handoverCode.deleteMany({ where: { offerId } });
    await prisma.workOffer.deleteMany({ where: { id: offerId } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    sent.length = 0;
    await prisma.handoverCode.deleteMany({ where: { offerId } });
    await prisma.payment.deleteMany({ where: { offerId } });
  });

  async function call(method: "GET" | "POST", path: string, body?: unknown) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> | null };
  }

  /** Ask for a code and read it from the SMS the worker received. */
  async function newCode(amount = 2000): Promise<string> {
    const r = await call("POST", "/api/payments/code", { offerId, amount });
    assert.equal(r.status, 201);
    const m = /Code: (\d{4})/.exec(sent.at(-1) ?? "");
    assert.ok(m, "the worker's SMS carries the code");
    return m[1]!;
  }

  const confirm = (code: string) =>
    call("POST", "/api/payments/confirm-code", { offerId, code, paidOn: "2026-10-17" });

  const wrongFor = (code: string) => (code === "1000" ? "1001" : "1000");

  async function payments() {
    const { prisma } = await import("../src/lib/prisma.js");
    return prisma.payment.count({ where: { offerId } });
  }

  it("refuses a wrong code and says how many tries are left", async () => {
    const code = await newCode();
    for (const left of [4, 3, 2, 1]) {
      const r = await confirm(wrongFor(code));
      assert.equal(r.status, 400);
      assert.equal(r.body?.code, "CODE_WRONG");
      assert.equal(r.body?.triesLeft, left);
    }
    assert.equal(await payments(), 0);
  });

  it("spends the code on the fifth wrong try, so even the right code records nothing after it", async () => {
    const code = await newCode();
    for (let i = 0; i < 4; i++) await confirm(wrongFor(code));

    const fifth = await confirm(wrongFor(code));
    assert.equal(fifth.status, 409);
    assert.equal(fifth.body?.code, "CODE_SPENT");

    const right = await confirm(code);
    assert.equal(right.status, 409);
    assert.equal(right.body?.code, "CODE_SPENT");
    assert.equal(await payments(), 0, "a spent code must not record a payment");
  });

  it("no longer shows a spent code as waiting", async () => {
    const code = await newCode();
    for (let i = 0; i < 5; i++) await confirm(wrongFor(code));
    const r = await call("GET", "/api/payments/pending-code");
    assert.equal(r.status, 200);
    assert.equal(r.body, null);
  });

  it("records the payment when the right code comes within five tries", async () => {
    const code = await newCode(2500);
    await confirm(wrongFor(code));
    await confirm(wrongFor(code));
    const r = await confirm(code);
    assert.equal(r.status, 201);
    assert.equal(r.body?.amount, 2500);
    assert.equal(await payments(), 1);
  });

  it("records one payment when the right code is sent twice at the same moment", async () => {
    const code = await newCode();
    const results = await Promise.all([confirm(code), confirm(code)]);
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 404]);
    assert.equal(results.find((r) => r.status === 404)?.body?.code, "NO_CODE");
    assert.equal(await payments(), 1);
  });

  it("refuses an expired code, and a wrong try on it is not counted", async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    const code = await newCode();
    await prisma.handoverCode.updateMany({ where: { offerId }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const right = await confirm(code);
    assert.equal(right.status, 409);
    assert.equal(right.body?.code, "CODE_EXPIRED");
    const wrong = await confirm(wrongFor(code));
    assert.equal(wrong.body?.code, "CODE_EXPIRED");
    assert.equal(await payments(), 0);
  });

  it("says when no code is waiting", async () => {
    const r = await confirm("1234");
    assert.equal(r.status, 404);
    assert.equal(r.body?.code, "NO_CODE");
  });

  it("does not take the code from Math.random", async () => {
    const { generateHandoverCode } = await import("../src/lib/sms.js");
    const real = Math.random;
    Math.random = () => 0;
    try {
      const codes = new Set(Array.from({ length: 40 }, () => generateHandoverCode()));
      for (const c of codes) assert.match(c, /^[1-9]\d{3}$/);
      assert.ok(codes.size > 1, "with Math.random fixed, the codes must still differ");
    } finally {
      Math.random = real;
    }
  });
});
