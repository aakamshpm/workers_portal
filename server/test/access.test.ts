import "./setup";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Access rules. ADR-0013. Contracts: docs/contracts/ledger.md.
 *
 * What these tests guarantee:
 * - a worker sees only the records of his own contracts;
 * - a contractor sees only the records of his own contracts, not another
 *   contractor's contract with the same worker;
 * - only the labour officer sees every record, or may filter by workerId;
 * - the integrity check still covers the whole chain, but only names problems
 *   in records the caller may see;
 * - nobody can list users without signing in;
 * - a contractor cannot browse workers, only find one by his full number;
 * - five wrong PINs lock the number for 15 minutes, and a right PIN resets it;
 * - a missing JWT_SECRET is refused, never replaced by a value in the code.
 *
 * Rows go into wage_test. Nothing calls textbee.dev.
 */

const PHONES = {
  workerA: "9999999951",
  workerB: "9999999952",
  contractorX: "9999999953",
  contractorY: "9999999954",
  officer: "9999999955",
};

type Ids = Record<keyof typeof PHONES, string>;

function listen(app: express.Express): Promise<{ base: string; server: Server }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () =>
      resolve({ base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server }),
    );
  });
}

describe("access rules", () => {
  let base = "";
  let server: Server;
  const ids = {} as Ids;
  const tokens = {} as Record<keyof typeof PHONES, string>;
  /** offerId -> [worker, contractor], so tests can say which contract a record belongs to. */
  const offers: Record<string, [keyof typeof PHONES, keyof typeof PHONES]> = {};

  before(async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    const { signToken } = await import("../src/lib/auth.js");
    const { appendToChain } = await import("../src/lib/ledger.js");
    const bcrypt = (await import("bcryptjs")).default;

    await prisma.workOffer.deleteMany({ where: { worker: { phone: { in: Object.values(PHONES) } } } });
    await prisma.user.deleteMany({ where: { phone: { in: Object.values(PHONES) } } });

    const pin = await bcrypt.hash("1234", 4);
    const roles: Record<keyof typeof PHONES, string> = {
      workerA: "WORKER",
      workerB: "WORKER",
      contractorX: "CONTRACTOR",
      contractorY: "CONTRACTOR",
      officer: "AUTHORITY",
    };
    for (const key of Object.keys(PHONES) as (keyof typeof PHONES)[]) {
      const u = await prisma.user.create({
        data: { phone: PHONES[key], name: `Access ${key}`, role: roles[key], pin },
      });
      ids[key] = u.id;
      tokens[key] = signToken({ id: u.id, name: u.name, phone: u.phone, role: roles[key] as never });
    }

    // Three contracts: A with X, A with Y, B with X. Worker A works for two
    // contractors, which is the case that must not leak between them.
    for (const [worker, contractor] of [
      ["workerA", "contractorX"],
      ["workerA", "contractorY"],
      ["workerB", "contractorX"],
    ] as const) {
      const offer = await prisma.$transaction(async (tx) => {
        const o = await tx.workOffer.create({
          data: {
            workerId: ids[worker],
            contractorId: ids[contractor],
            dailyRate: 800,
            workType: "Painting",
            siteName: `${worker}-${contractor}`,
            startDate: new Date("2026-10-01T00:00:00.000Z"),
            expectedDays: 10,
          },
        });
        await appendToChain(tx, {
          recordType: "OFFER",
          recordId: o.id,
          workerId: ids[worker],
          summary: `Offer ${worker}-${contractor}`,
          payload: {
            type: "OFFER",
            workerId: ids[worker],
            contractorId: ids[contractor],
            dailyRate: 800,
            workType: "Painting",
            siteName: `${worker}-${contractor}`,
            startDate: new Date("2026-10-01T00:00:00.000Z").toISOString(),
            expectedDays: 10,
            extraTerms: "",
          },
        });
        return o;
      });
      offers[offer.id] = [worker, contractor];
    }

    const { authRouter } = await import("../src/routes/auth.js");
    const { ledgerRouter } = await import("../src/routes/ledger.js");
    const { offersRouter } = await import("../src/routes/offers.js");
    const app = express();
    app.use(express.json());
    app.use("/api/auth", authRouter);
    app.use("/api/ledger", ledgerRouter);
    app.use("/api/offers", offersRouter);
    ({ base, server } = await listen(app));
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    const { prisma } = await import("../src/lib/prisma.js");
    await prisma.workOffer.deleteMany({ where: { id: { in: Object.keys(offers) } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await prisma.$disconnect();
  });

  async function get(path: string, who?: keyof typeof PHONES) {
    const res = await fetch(`${base}${path}`, {
      headers: who ? { Authorization: `Bearer ${tokens[who]}` } : {},
    });
    // A route that does not exist answers with Express's own HTML 404 page in
    // this small test app, so the body is read as text first.
    const text = await res.text();
    let body: any = text;
    try {
      body = JSON.parse(text);
    } catch {
      // not JSON, keep the text
    }
    return { status: res.status, body };
  }

  /** The contracts, as "worker-contractor", that a caller's ledger entries belong to. */
  async function contractsSeenBy(who: keyof typeof PHONES, query = "") {
    const { body } = await get(`/api/ledger${query}`, who);
    const mine = new Set(Object.keys(offers));
    return new Set(
      (body.entries as { recordType: string; recordId: string }[])
        .filter((e) => e.recordType === "OFFER" && mine.has(e.recordId))
        .map((e) => offers[e.recordId]!.join("-")),
    );
  }

  it("a worker sees only his own contracts' records", async () => {
    assert.deepEqual(await contractsSeenBy("workerA"), new Set(["workerA-contractorX", "workerA-contractorY"]));
    assert.deepEqual(await contractsSeenBy("workerB"), new Set(["workerB-contractorX"]));
  });

  it("a contractor sees only his own contracts, not the same worker's other contract", async () => {
    assert.deepEqual(await contractsSeenBy("contractorX"), new Set(["workerA-contractorX", "workerB-contractorX"]));
    assert.deepEqual(await contractsSeenBy("contractorY"), new Set(["workerA-contractorY"]));
  });

  it("a worker cannot read another worker's records by adding workerId", async () => {
    assert.deepEqual(
      await contractsSeenBy("workerB", `?workerId=${ids.workerA}`),
      new Set(["workerB-contractorX"]),
    );
  });

  it("the labour officer sees every record and may filter by worker", async () => {
    assert.deepEqual(
      await contractsSeenBy("officer"),
      new Set(["workerA-contractorX", "workerA-contractorY", "workerB-contractorX"]),
    );
    assert.deepEqual(
      await contractsSeenBy("officer", `?workerId=${ids.workerB}`),
      new Set(["workerB-contractorX"]),
    );
  });

  it("the integrity check covers the whole chain but names only problems the caller may see", async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    // Lower the rate on the A-Y contract behind the application's back.
    const [ay] = Object.entries(offers).find(([, v]) => v.join("-") === "workerA-contractorY")!;
    await prisma.workOffer.update({ where: { id: ay }, data: { dailyRate: 400 } });

    try {
      const post = async (who: keyof typeof PHONES) => {
        const res = await fetch(`${base}/api/ledger/verify`, {
          method: "POST",
          headers: { Authorization: `Bearer ${tokens[who]}` },
        });
        return (await res.json()) as {
          valid: boolean;
          failures: { recordType: string; summary: string }[];
          hiddenFailures: number;
        };
      };

      const x = await post("contractorX");
      assert.equal(x.valid, false, "the chain as a whole is broken, so it must not say valid");
      assert.ok(
        !x.failures.some((f) => f.summary.includes("workerA-contractorY")),
        "contractor X must not be shown the details of contractor Y's contract",
      );
      assert.ok(x.hiddenFailures >= 1, "contractor X must be told that a problem exists elsewhere");

      const a = await post("workerA");
      assert.ok(a.failures.some((f) => f.summary.includes("workerA-contractorY")), "worker A sees his own broken record");

      const o = await post("officer");
      assert.equal(o.hiddenFailures, 0, "nothing is hidden from the officer");
      assert.ok(o.failures.some((f) => f.summary.includes("workerA-contractorY")));
    } finally {
      await prisma.workOffer.update({ where: { id: ay }, data: { dailyRate: 800 } });
    }
  });

  it("no route lists users to someone who is not signed in", async () => {
    const { status } = await get("/api/auth/demo-accounts");
    assert.equal(status, 404);
  });

  it("a contractor cannot browse workers with an empty or partial number", async () => {
    for (const q of ["", "99999", "999999995"]) {
      const { status, body } = await get(`/api/offers/workers?phone=${q}`, "contractorX");
      assert.ok(status === 400 || (Array.isArray(body) && body.length === 0), `phone=${q} must not list workers`);
    }
  });

  it("a contractor finds one worker by his full number", async () => {
    const { status, body } = await get(`/api/offers/workers?phone=${PHONES.workerB}`, "contractorX");
    assert.equal(status, 200);
    assert.deepEqual(
      body.map((w: { phone: string }) => w.phone),
      [PHONES.workerB],
    );
  });
});

describe("wrong PINs", () => {
  const PHONE = "9999999961";
  let base = "";
  let server: Server;

  before(async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    const bcrypt = (await import("bcryptjs")).default;
    await prisma.user.deleteMany({ where: { phone: PHONE } });
    await prisma.user.create({
      data: { phone: PHONE, name: "Lockout Worker", role: "WORKER", pin: await bcrypt.hash("4321", 4) },
    });
    const { authRouter } = await import("../src/routes/auth.js");
    const app = express();
    app.use(express.json());
    app.use("/api/auth", authRouter);
    ({ base, server } = await listen(app));
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    const { prisma } = await import("../src/lib/prisma.js");
    await prisma.user.deleteMany({ where: { phone: PHONE } });
    await prisma.$disconnect();
  });

  async function login(pin: string) {
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: PHONE, pin }),
    });
    return { status: res.status, body: (await res.json()) as { error?: string; token?: string } };
  }

  async function unlock() {
    const { prisma } = await import("../src/lib/prisma.js");
    await prisma.user.update({ where: { phone: PHONE }, data: { failedPinCount: 0, lockedUntil: null } });
  }

  it("a right PIN resets the count of wrong ones", async () => {
    await unlock();
    for (let i = 0; i < 4; i++) assert.equal((await login("0000")).status, 401);
    assert.equal((await login("4321")).status, 200);
    // Four more wrong, which would be nine in a row without the reset.
    for (let i = 0; i < 4; i++) assert.equal((await login("0000")).status, 401);
    assert.equal((await login("4321")).status, 200, "still not locked after the reset");
  });

  it("five wrong PINs lock the number, and then even the right PIN is refused", async () => {
    await unlock();
    for (let i = 0; i < 5; i++) assert.equal((await login("0000")).status, 401);
    const locked = await login("4321");
    assert.equal(locked.status, 429);
    assert.match(locked.body.error ?? "", /15 minutes/);
    assert.equal(locked.body.token, undefined);
  });

  it("the lock ends after 15 minutes", async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    await prisma.user.update({
      where: { phone: PHONE },
      data: { failedPinCount: 5, lockedUntil: new Date(Date.now() - 1000) },
    });
    assert.equal((await login("4321")).status, 200);
  });
});

describe("JWT_SECRET", () => {
  it("is required, never replaced by a value written in the code", async () => {
    const { getJwtSecret } = await import("../src/lib/auth.js");
    const saved = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    try {
      assert.throws(() => getJwtSecret(), /JWT_SECRET/);
    } finally {
      process.env.JWT_SECRET = saved;
    }
  });
});
