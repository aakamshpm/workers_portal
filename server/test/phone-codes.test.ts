import "./setup";
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Phone codes, registration, PIN reset and officer-made accounts.
 * ADR-0014. Contract: docs/contracts/auth.md.
 *
 * What these tests guarantee:
 * - nobody can register a phone number without the code sent to that phone;
 * - a code is 6 digits, works once, expires, and dies after 5 wrong tries;
 * - the code is never stored in plain text;
 * - asking for a code answers the same way for registered and unregistered
 *   numbers, so the route cannot be used to find out who has an account;
 * - codes are limited to 1 a minute and 5 a day per number;
 * - "forgot PIN" sets a new PIN only with a code sent to the account's phone,
 *   and it clears the wrong-PIN lock;
 * - only a labour officer creates contractor and officer accounts; the new
 *   account has no PIN, cannot sign in, and its owner sets the PIN himself;
 * - nobody else can list or create accounts.
 *
 * The SMS provider is a fake that records each code it would have sent. No
 * test calls textbee.dev.
 */

const P = {
  newWorker: "9999999971",
  existing: "9999999972",
  officer: "9999999973",
  contractor: "9999999974",
  madeByOfficer: "9999999975",
  quiet: "9999999976",
};

function listen(app: express.Express): Promise<{ base: string; server: Server }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () =>
      resolve({ base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server }),
    );
  });
}

/** Every SMS the fake provider would have sent: [to, body]. */
const sent: [string, string][] = [];

/** The last 6-digit code sent to a phone. */
function lastCode(phone: string): string {
  const m = [...sent].reverse().find(([to]) => to.endsWith(phone));
  const code = m?.[1].match(/\b(\d{6})\b/)?.[1];
  assert.ok(code, `no code was sent to ${phone}`);
  return code;
}

describe("phone codes and accounts", () => {
  let base = "";
  let server: Server;
  let officerToken = "";
  let contractorToken = "";

  before(async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    const sms = await import("../src/lib/sms.js");
    const { signToken } = await import("../src/lib/auth.js");
    const bcrypt = (await import("bcryptjs")).default;

    sms.setSmsProvider({
      async send({ to, body }) {
        sent.push([to, body]);
        return { id: `fake-${sent.length}`, status: "queued" };
      },
    });

    await prisma.phoneCode.deleteMany({ where: { phone: { in: Object.values(P) } } });
    await prisma.user.deleteMany({ where: { phone: { in: Object.values(P) } } });

    const pin = await bcrypt.hash("1111", 4);
    await prisma.user.create({ data: { phone: P.existing, name: "Existing Worker", role: "WORKER", pin } });
    const officer = await prisma.user.create({ data: { phone: P.officer, name: "Code Officer", role: "AUTHORITY", pin } });
    const contractor = await prisma.user.create({
      data: { phone: P.contractor, name: "Code Contractor", role: "CONTRACTOR", pin, company: "C Co" },
    });
    officerToken = signToken({ id: officer.id, name: officer.name, phone: officer.phone, role: "AUTHORITY" });
    contractorToken = signToken({ id: contractor.id, name: contractor.name, phone: contractor.phone, role: "CONTRACTOR" });

    const { authRouter } = await import("../src/routes/auth.js");
    const { accountsRouter } = await import("../src/routes/accounts.js");
    const app = express();
    app.use(express.json());
    app.use("/api/auth", authRouter);
    app.use("/api/accounts", accountsRouter);
    ({ base, server } = await listen(app));
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    const { prisma } = await import("../src/lib/prisma.js");
    const sms = await import("../src/lib/sms.js");
    sms.setSmsProvider(null);
    await prisma.phoneCode.deleteMany({ where: { phone: { in: Object.values(P) } } });
    await prisma.user.deleteMany({ where: { phone: { in: Object.values(P) } } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    sent.length = 0;
  });

  async function post(path: string, body: unknown, token?: string) {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  }

  async function get(path: string, token?: string) {
    const res = await fetch(`${base}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return { status: res.status, body: (await res.json()) as any };
  }

  /**
   * Let the next code be requested at once. Moves earlier codes back 25 hours,
   * out of both the one-minute gap and the five-a-day window, so each test
   * starts with fresh limits. The limit tests themselves set their own rows.
   */
  async function skipWait(phone: string) {
    const { prisma } = await import("../src/lib/prisma.js");
    await prisma.phoneCode.updateMany({
      where: { phone },
      data: { createdAt: new Date(Date.now() - 25 * 60 * 60_000) },
    });
  }

  // --- asking for a code ---------------------------------------------------

  it("sends a 6-digit code to a new number for registration", async () => {
    const r = await post("/api/auth/code", { phone: P.newWorker, purpose: "REGISTER" });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { sent: true, expiresInMinutes: 10 });
    assert.match(lastCode(P.newWorker), /^\d{6}$/);
  });

  it("stores the code only as a hash, never in plain text", async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    await skipWait(P.newWorker);
    await post("/api/auth/code", { phone: P.newWorker, purpose: "REGISTER" });
    const code = lastCode(P.newWorker);
    const rows = await prisma.phoneCode.findMany({ where: { phone: P.newWorker } });
    assert.ok(rows.length >= 1);
    for (const row of rows) assert.ok(!JSON.stringify(row).includes(code), "the plain code must not be stored");
  });

  it("answers the same for registered and unregistered numbers, and sends only where it makes sense", async () => {
    await skipWait(P.existing);
    const reg = await post("/api/auth/code", { phone: P.existing, purpose: "REGISTER" });
    const reset = await post("/api/auth/code", { phone: P.quiet, purpose: "RESET_PIN" });
    assert.deepEqual(reg, { status: 200, body: { sent: true, expiresInMinutes: 10 } });
    assert.deepEqual(reset, { status: 200, body: { sent: true, expiresInMinutes: 10 } });
    assert.equal(sent.length, 0, "no SMS to a registered number for REGISTER, or an unknown one for RESET_PIN");
  });

  it("allows only one code a minute per number", async () => {
    await skipWait(P.newWorker);
    assert.equal((await post("/api/auth/code", { phone: P.newWorker, purpose: "REGISTER" })).status, 200);
    const again = await post("/api/auth/code", { phone: P.newWorker, purpose: "REGISTER" });
    assert.equal(again.status, 429);
    assert.match(again.body.error, /minute/);
  });

  it("allows at most 5 codes a day per number", async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    const hour = (h: number) => new Date(Date.now() - h * 60 * 60_000);
    await prisma.phoneCode.deleteMany({ where: { phone: P.quiet } });
    await prisma.phoneCode.createMany({
      data: [1, 2, 3, 4, 5].map((h) => ({
        phone: P.quiet,
        purpose: "REGISTER",
        codeHash: "x",
        expiresAt: hour(h),
        createdAt: hour(h),
      })),
    });
    const r = await post("/api/auth/code", { phone: P.quiet, purpose: "REGISTER" });
    assert.equal(r.status, 429);
    assert.match(r.body.error, /today/);
    await prisma.phoneCode.deleteMany({ where: { phone: P.quiet } });
  });

  it("refuses a number that is not 10 digits", async () => {
    assert.equal((await post("/api/auth/code", { phone: "12345", purpose: "REGISTER" })).status, 400);
  });

  // --- registering ---------------------------------------------------------

  it("does not register a number without the right code", async () => {
    await skipWait(P.newWorker);
    await post("/api/auth/code", { phone: P.newWorker, purpose: "REGISTER" });
    const r = await post("/api/auth/register", {
      phone: P.newWorker,
      code: "000000",
      name: "Ramu",
      homeState: "Assam",
      pin: "5739",
    });
    assert.equal(r.status, 400);
  });

  it("registers a worker with the code sent to his phone, and the code works only once", async () => {
    await skipWait(P.newWorker);
    await post("/api/auth/code", { phone: P.newWorker, purpose: "REGISTER" });
    const code = lastCode(P.newWorker);
    const body = { phone: P.newWorker, code, name: "Ramu", homeState: "Assam", pin: "5739" };

    const r = await post("/api/auth/register", body);
    assert.equal(r.status, 201);
    assert.equal(r.body.user.role, "WORKER");
    assert.ok(r.body.token);

    const login = await post("/api/auth/login", { phone: P.newWorker, pin: "5739" });
    assert.equal(login.status, 200, "the new worker can sign in with the PIN he chose");

    const { prisma } = await import("../src/lib/prisma.js");
    await prisma.user.delete({ where: { phone: P.newWorker } });
    assert.equal((await post("/api/auth/register", body)).status, 400, "a used code must not work again");
  });

  it("spends a code after 5 wrong tries, so the right code no longer works", async () => {
    await skipWait(P.newWorker);
    await post("/api/auth/code", { phone: P.newWorker, purpose: "REGISTER" });
    const code = lastCode(P.newWorker);
    const body = { phone: P.newWorker, name: "Ramu", homeState: "Assam", pin: "5739" };
    for (let i = 0; i < 5; i++) {
      assert.equal((await post("/api/auth/register", { ...body, code: "000000" })).status, 400);
    }
    assert.equal((await post("/api/auth/register", { ...body, code })).status, 400);
  });

  it("does not accept an expired code", async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    await skipWait(P.newWorker);
    await post("/api/auth/code", { phone: P.newWorker, purpose: "REGISTER" });
    const code = lastCode(P.newWorker);
    await prisma.phoneCode.updateMany({
      where: { phone: P.newWorker },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const r = await post("/api/auth/register", {
      phone: P.newWorker,
      code,
      name: "Ramu",
      homeState: "Assam",
      pin: "5739",
    });
    assert.equal(r.status, 400);
  });

  it("does not let a RESET_PIN code register an account", async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    const bcrypt = (await import("bcryptjs")).default;
    // A reset code can only be sent to an existing account, so create one,
    // take its code, then remove the account and try to register with it.
    await prisma.user.create({
      data: { phone: P.quiet, name: "Temp", role: "WORKER", pin: await bcrypt.hash("1111", 4) },
    });
    await post("/api/auth/code", { phone: P.quiet, purpose: "RESET_PIN" });
    const code = lastCode(P.quiet);
    await prisma.user.delete({ where: { phone: P.quiet } });
    const r = await post("/api/auth/register", {
      phone: P.quiet,
      code,
      name: "Ramu",
      homeState: "Assam",
      pin: "5739",
    });
    assert.equal(r.status, 400);
    await prisma.phoneCode.deleteMany({ where: { phone: P.quiet } });
  });

  // --- forgot PIN ----------------------------------------------------------

  it("sets a new PIN with the code, clears the lock, and the old PIN stops working", async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    await prisma.user.update({
      where: { phone: P.existing },
      data: { lockedUntil: new Date(Date.now() + 10 * 60_000), failedPinCount: 3 },
    });
    await skipWait(P.existing);
    await post("/api/auth/code", { phone: P.existing, purpose: "RESET_PIN" });

    const r = await post("/api/auth/reset-pin", { phone: P.existing, code: lastCode(P.existing), pin: "2468" });
    assert.equal(r.status, 200);
    assert.ok(r.body.token);

    assert.equal((await post("/api/auth/login", { phone: P.existing, pin: "1111" })).status, 401);
    assert.equal((await post("/api/auth/login", { phone: P.existing, pin: "2468" })).status, 200);
  });

  it("does not reset a PIN with a wrong code", async () => {
    await skipWait(P.existing);
    await post("/api/auth/code", { phone: P.existing, purpose: "RESET_PIN" });
    const r = await post("/api/auth/reset-pin", { phone: P.existing, code: "000000", pin: "9999" });
    assert.equal(r.status, 400);
    assert.equal((await post("/api/auth/login", { phone: P.existing, pin: "9999" })).status, 401);
  });

  // --- accounts made by the labour office ----------------------------------

  it("lets only a labour officer list and create accounts", async () => {
    assert.equal((await get("/api/accounts")).status, 401);
    assert.equal((await get("/api/accounts", contractorToken)).status, 403);
    const made = await post(
      "/api/accounts",
      { role: "CONTRACTOR", name: "X", phone: P.madeByOfficer, company: "X Co" },
      contractorToken,
    );
    assert.equal(made.status, 403);
  });

  it("creates a contractor with no PIN, who cannot sign in until he sets one", async () => {
    const r = await post(
      "/api/accounts",
      { role: "CONTRACTOR", name: "Joseph K", phone: P.madeByOfficer, company: "Joseph Constructions" },
      officerToken,
    );
    assert.equal(r.status, 201);
    assert.equal(r.body.role, "CONTRACTOR");
    assert.equal(r.body.hasPin, false);
    assert.equal(r.body.company, "Joseph Constructions");
    assert.ok(!("pin" in r.body), "the PIN field must never be returned");
    assert.equal(sent.length, 0, "creating an account sends no SMS");

    for (const pin of ["0000", "1234", ""]) {
      assert.equal(
        (await post("/api/auth/login", { phone: P.madeByOfficer, pin })).status,
        pin === "" ? 400 : 401,
      );
    }

    // The owner sets his own PIN with a code to his own phone.
    await post("/api/auth/code", { phone: P.madeByOfficer, purpose: "RESET_PIN" });
    const set = await post("/api/auth/reset-pin", { phone: P.madeByOfficer, code: lastCode(P.madeByOfficer), pin: "8642" });
    assert.equal(set.status, 200);
    assert.equal(set.body.user.role, "CONTRACTOR");
    assert.equal((await post("/api/auth/login", { phone: P.madeByOfficer, pin: "8642" })).status, 200);
  });

  it("lists contractor and officer accounts with hasPin, and not workers", async () => {
    const r = await get("/api/accounts", officerToken);
    assert.equal(r.status, 200);
    const phones = r.body.accounts.map((a: { phone: string }) => a.phone);
    assert.ok(phones.includes(P.madeByOfficer));
    assert.ok(phones.includes(P.officer));
    assert.ok(!phones.includes(P.existing), "workers are not listed");
    const joseph = r.body.accounts.find((a: { phone: string }) => a.phone === P.madeByOfficer);
    assert.equal(joseph.hasPin, true, "Joseph set his PIN in the test above");
    for (const a of r.body.accounts) assert.ok(!("pin" in a));
  });

  it("refuses a duplicate number, a contractor with no company, and a worker role", async () => {
    const dup = await post(
      "/api/accounts",
      { role: "CONTRACTOR", name: "Dup", phone: P.existing, company: "D Co" },
      officerToken,
    );
    assert.equal(dup.status, 409);
    const noCompany = await post("/api/accounts", { role: "CONTRACTOR", name: "NC", phone: P.quiet }, officerToken);
    assert.equal(noCompany.status, 400);
    const worker = await post("/api/accounts", { role: "WORKER", name: "W", phone: P.quiet }, officerToken);
    assert.equal(worker.status, 400);
  });
});
