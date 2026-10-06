import "./setup";
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * The sign-in routes tell the user what really happened. ADR-0020.
 * Contract: docs/contracts/auth.md, "Errors from the sign-in routes".
 *
 * What these tests guarantee:
 * - a registration code for a number that already has an account is refused
 *   with PHONE_REGISTERED, and a reset code for a number with no account with
 *   PHONE_NOT_REGISTERED. Neither sends an SMS or stores a code, so the
 *   worker is never told a code is coming when none is;
 * - a failed SMS answers SMS_FAILED, stores no code, keeps the earlier code
 *   working, and does not use up one of the five codes a day;
 * - an SMS gateway that does not answer counts as failed after the time limit,
 *   so the page does not wait for minutes;
 * - every error from these routes has a fixed `code` next to the English
 *   `error`, so the page can show it in the reader's language;
 * - the fifth wrong PIN says the number is locked, with the real minutes left.
 *
 * The SMS provider is a fake. No test calls textbee.dev.
 */

const P = {
  registered: "9999999941",
  fresh: "9999999942",
  failing: "9999999943",
  locked: "9999999944",
};

function listen(app: express.Express): Promise<{ base: string; server: Server }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () =>
      resolve({ base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server }),
    );
  });
}

/** What the fake provider does on the next send. */
let mode: "ok" | "fail" | "hang" = "ok";
const sent: [string, string][] = [];

describe("sign-in routes tell the truth", () => {
  let base = "";
  let server: Server;

  before(async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    const sms = await import("../src/lib/sms.js");
    const bcrypt = (await import("bcryptjs")).default;

    sms.setSmsProvider({
      async send({ to, body }) {
        if (mode === "fail") throw new Error("Textbee send failed with HTTP 503");
        if (mode === "hang") await new Promise(() => {});
        sent.push([to, body]);
        return { id: `fake-${sent.length}`, status: "queued" };
      },
    });
    // Short, so the "does not answer" test does not wait 15 seconds.
    sms.setSendTimeoutMs(300);

    await prisma.phoneCode.deleteMany({ where: { phone: { in: Object.values(P) } } });
    await prisma.user.deleteMany({ where: { phone: { in: Object.values(P) } } });
    const pin = await bcrypt.hash("4321", 4);
    await prisma.user.create({ data: { phone: P.registered, name: "Has Account", role: "WORKER", pin } });
    await prisma.user.create({ data: { phone: P.locked, name: "Locks Out", role: "WORKER", pin } });

    const { authRouter } = await import("../src/routes/auth.js");
    const app = express();
    app.use(express.json());
    app.use("/api/auth", authRouter);
    ({ base, server } = await listen(app));
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    const { prisma } = await import("../src/lib/prisma.js");
    const sms = await import("../src/lib/sms.js");
    sms.setSmsProvider(null);
    sms.setSendTimeoutMs(null);
    await prisma.phoneCode.deleteMany({ where: { phone: { in: Object.values(P) } } });
    await prisma.user.deleteMany({ where: { phone: { in: Object.values(P) } } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    sent.length = 0;
    mode = "ok";
    const { prisma } = await import("../src/lib/prisma.js");
    await prisma.phoneCode.deleteMany({ where: { phone: { in: Object.values(P) } } });
  });

  async function post(path: string, body: unknown) {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  }

  async function codeRows(phone: string) {
    const { prisma } = await import("../src/lib/prisma.js");
    return prisma.phoneCode.findMany({ where: { phone } });
  }

  // --- the number does not fit the flow ------------------------------------

  it("refuses a registration code for a number that already has an account, and sends nothing", async () => {
    const r = await post("/api/auth/code", { phone: P.registered, purpose: "REGISTER" });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "PHONE_REGISTERED");
    assert.equal(typeof r.body.error, "string");
    assert.equal(sent.length, 0);
    assert.equal((await codeRows(P.registered)).length, 0);
  });

  it("refuses a reset code for a number with no account, and sends nothing", async () => {
    const r = await post("/api/auth/code", { phone: P.fresh, purpose: "RESET_PIN" });
    assert.equal(r.status, 404);
    assert.equal(r.body.code, "PHONE_NOT_REGISTERED");
    assert.equal(sent.length, 0);
    assert.equal((await codeRows(P.fresh)).length, 0);
  });

  it("still sends a registration code to a new number and a reset code to an account", async () => {
    const reg = await post("/api/auth/code", { phone: P.fresh, purpose: "REGISTER" });
    const reset = await post("/api/auth/code", { phone: P.registered, purpose: "RESET_PIN" });
    assert.deepEqual(reg, { status: 200, body: { sent: true, expiresInMinutes: 10 } });
    assert.deepEqual(reset, { status: 200, body: { sent: true, expiresInMinutes: 10 } });
    assert.equal(sent.length, 2);
  });

  // --- the SMS does not go out ---------------------------------------------

  it("answers SMS_FAILED when the gateway refuses, and stores no code", async () => {
    mode = "fail";
    const r = await post("/api/auth/code", { phone: P.failing, purpose: "REGISTER" });
    assert.equal(r.status, 502);
    assert.equal(r.body.code, "SMS_FAILED");
    assert.equal((await codeRows(P.failing)).length, 0);
  });

  it("lets the worker ask again at once after a failed SMS, because the failure used no limit", async () => {
    mode = "fail";
    await post("/api/auth/code", { phone: P.failing, purpose: "REGISTER" });
    mode = "ok";
    const again = await post("/api/auth/code", { phone: P.failing, purpose: "REGISTER" });
    assert.equal(again.status, 200, "a failed send must not start the one-minute wait");
    assert.equal(sent.length, 1);
  });

  it("keeps the earlier code working when a new request fails to send", async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    await post("/api/auth/code", { phone: P.failing, purpose: "REGISTER" });
    const first = sent.at(-1)![1].match(/\b(\d{6})\b/)![1]!;
    // Out of the one-minute gap, so the second request is allowed.
    await prisma.phoneCode.updateMany({
      where: { phone: P.failing },
      data: { createdAt: new Date(Date.now() - 2 * 60_000) },
    });

    mode = "fail";
    assert.equal((await post("/api/auth/code", { phone: P.failing, purpose: "REGISTER" })).status, 502);

    const reg = await post("/api/auth/register", {
      phone: P.failing,
      code: first,
      name: "Still Works",
      pin: "5739",
    });
    assert.equal(reg.status, 201, "the code that did arrive must still work");
    await prisma.user.deleteMany({ where: { phone: P.failing } });
  });

  it("gives up on a gateway that does not answer, instead of waiting for minutes", async () => {
    mode = "hang";
    const started = Date.now();
    // The test stops waiting after 5 s itself, so a missing server time limit
    // shows as a named failure here and not as a cancelled test.
    const res = await fetch(`${base}/api/auth/code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: P.failing, purpose: "REGISTER" }),
      signal: AbortSignal.timeout(5_000),
    }).catch(() => null);
    assert.ok(res, "the server did not answer within 5 s: the SMS send has no time limit");
    const r = { status: res.status, body: (await res.json()) as any };
    assert.equal(r.status, 502);
    assert.equal(r.body.code, "SMS_FAILED");
    assert.ok(Date.now() - started < 5_000, "the time limit must end the request");
    assert.equal((await codeRows(P.failing)).length, 0);
  });

  // --- every error carries a code ------------------------------------------

  it("gives every refusal a fixed code next to the English message", async () => {
    const cases: [string, unknown, number, string][] = [
      ["/api/auth/code", { phone: "12345", purpose: "REGISTER" }, 400, "INVALID_PHONE"],
      ["/api/auth/code", { phone: P.fresh, purpose: "WRONG" }, 400, "INVALID_INPUT"],
      ["/api/auth/register", { phone: P.fresh, code: "123456", name: "A B", pin: "1234" }, 400, "CODE_WRONG"],
      ["/api/auth/register", { phone: P.registered, code: "123456", name: "A B", pin: "1234" }, 409, "PHONE_REGISTERED"],
      ["/api/auth/reset-pin", { phone: P.fresh, code: "123456", pin: "1234" }, 400, "CODE_WRONG"],
      ["/api/auth/login", { phone: P.fresh, pin: "1234" }, 404, "PHONE_NOT_REGISTERED"],
    ];
    for (const [path, body, status, code] of cases) {
      const r = await post(path, body);
      assert.equal(r.status, status, `${path} ${JSON.stringify(body)}`);
      assert.equal(r.body.code, code, `${path} ${JSON.stringify(body)}`);
      assert.equal(typeof r.body.error, "string");
    }
  });

  it("gives the wait and the daily limit their own codes", async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    await post("/api/auth/code", { phone: P.fresh, purpose: "REGISTER" });
    const wait = await post("/api/auth/code", { phone: P.fresh, purpose: "REGISTER" });
    assert.equal(wait.status, 429);
    assert.equal(wait.body.code, "CODE_WAIT");

    const hour = (h: number) => new Date(Date.now() - h * 60 * 60_000);
    await prisma.phoneCode.deleteMany({ where: { phone: P.fresh } });
    await prisma.phoneCode.createMany({
      data: [1, 2, 3, 4, 5].map((h) => ({
        phone: P.fresh,
        purpose: "REGISTER",
        codeHash: "x",
        expiresAt: hour(h),
        createdAt: hour(h),
      })),
    });
    const daily = await post("/api/auth/code", { phone: P.fresh, purpose: "REGISTER" });
    assert.equal(daily.status, 429);
    assert.equal(daily.body.code, "CODE_DAILY_LIMIT");
  });

  // --- login: a number with no account (ADR-0022) ---------------------------

  it("tells a number with no account that it has no account, not that the PIN is wrong", async () => {
    const r = await post("/api/auth/login", { phone: P.fresh, pin: "1234" });
    assert.equal(r.status, 404);
    assert.equal(r.body.code, "PHONE_NOT_REGISTERED");
    assert.match(r.body.error, /no account/i);
    assert.doesNotMatch(r.body.error, /PIN/i, "the message must not blame the PIN");
  });

  it("still says the PIN is wrong for a number that has an account", async () => {
    const r = await post("/api/auth/login", { phone: P.registered, pin: "0000" });
    assert.equal(r.status, 401);
    assert.equal(r.body.code, "WRONG_PIN");
  });

  it("does not count tries on a number with no account towards any lock", async () => {
    for (let i = 0; i < 7; i++) {
      const r = await post("/api/auth/login", { phone: P.fresh, pin: "0000" });
      assert.equal(r.body.code, "PHONE_NOT_REGISTERED", `try ${i + 1}`);
    }
  });

  // --- the PIN lock --------------------------------------------------------

  it("says the number is locked on the fifth wrong PIN, not on the sixth", async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    await prisma.user.update({ where: { phone: P.locked }, data: { failedPinCount: 0, lockedUntil: null } });
    for (let i = 0; i < 4; i++) {
      const r = await post("/api/auth/login", { phone: P.locked, pin: "0000" });
      assert.equal(r.body.code, "WRONG_PIN");
    }
    const fifth = await post("/api/auth/login", { phone: P.locked, pin: "0000" });
    assert.equal(fifth.status, 429);
    assert.equal(fifth.body.code, "PIN_LOCKED");
    assert.equal(fifth.body.minutesLeft, 15);
  });

  it("tells a locked number the real minutes left, rounded up", async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    await prisma.user.update({
      where: { phone: P.locked },
      data: { lockedUntil: new Date(Date.now() + 4 * 60_000 + 10_000), failedPinCount: 0 },
    });
    const r = await post("/api/auth/login", { phone: P.locked, pin: "4321" });
    assert.equal(r.status, 429);
    assert.equal(r.body.code, "PIN_LOCKED");
    assert.equal(r.body.minutesLeft, 5);
  });
});
