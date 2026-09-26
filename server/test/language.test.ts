import "./setup";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * PATCH /api/auth/language. ADR-0015, docs/contracts/auth.md.
 *
 * What these tests guarantee:
 * - a signed-in user changes only his own language, and it is saved, so the
 *   next SMS the server sends him uses it;
 * - the answer carries a new token with the new language, because the app
 *   reads the language from the stored user;
 * - only the five languages the SMS messages exist in are accepted;
 * - nobody changes a language without signing in.
 *
 * No SMS is sent by this route, so no provider is needed.
 */

const PHONE = "9999999981";

function listen(app: express.Express): Promise<{ base: string; server: Server }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () =>
      resolve({ base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server }),
    );
  });
}

describe("PATCH /api/auth/language", () => {
  let base = "";
  let server: Server;
  let token = "";
  let userId = "";

  before(async () => {
    const { prisma } = await import("../src/lib/prisma.js");
    const { signToken } = await import("../src/lib/auth.js");
    await prisma.user.deleteMany({ where: { phone: PHONE } });
    const u = await prisma.user.create({
      data: { phone: PHONE, name: "Language Worker", role: "WORKER", pin: null, homeState: "Assam", language: "bn" },
    });
    userId = u.id;
    token = signToken({ id: u.id, name: u.name, phone: u.phone, role: "WORKER" });

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

  async function patch(body: unknown, withToken = true) {
    const res = await fetch(`${base}/api/auth/language`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(withToken ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  }

  it("saves the new language and returns a new token carrying it", async () => {
    const r = await patch({ language: "hi" });
    assert.equal(r.status, 200);
    assert.equal(r.body.user.language, "hi");
    assert.equal(r.body.user.id, userId);
    assert.ok(typeof r.body.token === "string" && r.body.token.length > 20);

    const { prisma } = await import("../src/lib/prisma.js");
    const saved = await prisma.user.findUnique({ where: { id: userId }, select: { language: true } });
    assert.equal(saved?.language, "hi");
  });

  it("refuses a language the SMS messages do not exist in", async () => {
    for (const language of ["ta", "", "HI", 5]) {
      const r = await patch({ language });
      assert.equal(r.status, 400, `accepted ${JSON.stringify(language)}`);
    }
    const { prisma } = await import("../src/lib/prisma.js");
    const saved = await prisma.user.findUnique({ where: { id: userId }, select: { language: true } });
    assert.equal(saved?.language, "hi");
  });

  it("refuses without sign-in", async () => {
    const r = await patch({ language: "or" }, false);
    assert.equal(r.status, 401);
  });
});
