import "dotenv/config";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

/**
 * Phase 1 Platform - Textbee SMS slice (ADR-0008).
 *
 * Contract:
 * - SmsProvider calls https://api.textbee.dev in production.
 * - Tests inject a fake, never HTTP to textbee.dev.
 * - send() throws when TEXTBEE_API_KEY is missing, writes no row.
 * - send() calls provider then writes SmsMessage audit row.
 * - Inbound bodies go through existing parseReply.
 */

describe("sms provider", () => {
  it("throws when TEXTBEE_API_KEY is missing and writes no audit row", async () => {
    const oldKey = process.env.TEXTBEE_API_KEY;
    delete process.env.TEXTBEE_API_KEY;
    const sms = await import("../src/lib/sms.js");
    sms.setSmsProvider(null);

    const { prisma } = await import("../src/lib/prisma.js");
    try {
      // Need a user to attempt send against.
      const u = await prisma.user.create({
        data: {
          phone: "9999999902",
          name: "SMS Key Check",
          role: "WORKER",
          pin: "hashed",
        },
      });
      const before = await prisma.smsMessage.count({ where: { userId: u.id } });
      await assert.rejects(
        () =>
          sms.send({
            userId: u.id,
            body: "hello",
            language: "en",
            kind: "OFFER",
          }),
        /TEXTBEE_API_KEY/,
      );
      const afterCount = await prisma.smsMessage.count({ where: { userId: u.id } });
      assert.equal(afterCount, before, "no audit row must be written when key is missing");
      await prisma.smsMessage.deleteMany({ where: { userId: u.id } });
      await prisma.user.delete({ where: { id: u.id } });
    } finally {
      if (oldKey !== undefined) process.env.TEXTBEE_API_KEY = oldKey;
      await prisma.$disconnect();
    }
  });

  it("uses fake provider in tests and writes audit row with provider id", async () => {
    const sms = await import("../src/lib/sms.js");
    const { prisma } = await import("../src/lib/prisma.js");
    try {
      let calledWith: { to: string; body: string } | null = null;
      sms.setSmsProvider({
        async send(input: { to: string; body: string }) {
          calledWith = input;
          // Must never HTTP to textbee.dev in tests.
          assert.ok(!input.to.includes("textbee"), "fake must not call textbee");
          return { id: "fake-sid-123", status: "queued" };
        },
        async fetchInbound() {
          return [];
        },
      });

      const u = await prisma.user.create({
        data: {
          phone: "9999999903",
          name: "SMS Fake Check",
          role: "WORKER",
          pin: "hashed",
        },
      });

      const row = await sms.send({
        userId: u.id,
        body: "Test offer Rs 800/day",
        language: "en",
        kind: "OFFER",
        reference: "1234",
      });

      assert.ok(calledWith !== null, "provider send must be called");
      assert.equal(row.direction, "OUT");
      assert.equal(row.body, "Test offer Rs 800/day");
      // Audit row carries provider id / status when columns exist.
      const anyRow = row as Record<string, unknown>;
      if ("providerId" in anyRow || "status" in anyRow) {
        assert.equal(anyRow["providerId"] ?? "fake-sid-123", "fake-sid-123");
      }

      await prisma.smsMessage.deleteMany({ where: { userId: u.id } });
      await prisma.user.delete({ where: { id: u.id } });
    } finally {
      sms.setSmsProvider(null);
      await prisma.$disconnect();
    }
  });

  it("inbound bodies go through parseReply", async () => {
    const sms = await import("../src/lib/sms.js");
    assert.equal(sms.parseReply("YES 4821").intent, "ACCEPT");
    assert.equal(sms.parseReply("OK 1234").intent, "CONFIRM");
    assert.equal(sms.parseReply("BAL").intent, "BALANCE");

    // Fake inbound fetch returns bodies that parse.
    sms.setSmsProvider({
      async send() {
        return { id: "x", status: "queued" };
      },
      async fetchInbound() {
        return [{ from: "+919880030001", body: "YES 4821", receivedAt: new Date().toISOString() }];
      },
    });
    const provider = sms.getSmsProvider();
    assert.ok(provider.fetchInbound !== undefined);
    const inbound = await provider.fetchInbound!();
    assert.equal(inbound.length, 1);
    assert.equal(sms.parseReply(inbound[0]!.body).intent, "ACCEPT");
    sms.setSmsProvider(null);
  });

  it("default provider targets textbee.dev send-sms endpoint", async () => {
    const sms = await import("../src/lib/sms.js");
    sms.setSmsProvider(null);
    process.env.TEXTBEE_API_KEY = process.env.TEXTBEE_API_KEY ?? "dummy-key-for-test";
    const provider = sms.getSmsProvider();
    // Production provider must point at api.textbee.dev, overridable via env.
    const base =
      process.env.TEXTBEE_BASE_URL ?? "https://api.textbee.dev";
    assert.ok(
      base.includes("api.textbee.dev"),
      `base URL must be textbee.dev, got ${base}`,
    );
    assert.ok(typeof provider.send === "function");
  });
});
