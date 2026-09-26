import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

/**
 * ===========================================================================
 * One-time phone codes. ADR-0014, docs/contracts/auth.md.
 * ===========================================================================
 *
 * A code proves that the person registering, or setting a PIN, holds the
 * phone. The rules, and why:
 *
 *   - 6 digits from the operating system's random source, not Math.random,
 *     because a code that can be predicted proves nothing.
 *   - Stored only as a bcrypt hash, so the database never holds a usable code.
 *   - Expires after 10 minutes and works once.
 *   - Spent after 5 wrong tries, so guessing 1,000,000 values is not possible.
 *   - One live code per phone and purpose: a new request replaces the old one.
 *   - At most 1 code a minute and 5 a day per phone, to protect the worker
 *     from floods of SMS and the Textbee budget from being used up.
 */

export type CodePurpose = "REGISTER" | "RESET_PIN";

export const CODE_MINUTES = 10;
const MAX_WRONG_TRIES = 5;
const GAP_MS = 60_000;
const MAX_PER_DAY = 5;

export type CodeRequest =
  | { ok: true; code: string }
  | { ok: false; status: 429; error: string };

/**
 * Make a new code for a phone and purpose, if the limits allow it.
 *
 * Returns the plain code so the caller can send it. The plain code is never
 * stored, and it is not returned to the browser.
 */
export async function createCode(phone: string, purpose: CodePurpose): Promise<CodeRequest> {
  const now = Date.now();

  // Counted across both purposes, because both send an SMS to the same phone.
  const recent = await prisma.phoneCode.findMany({
    where: { phone, createdAt: { gt: new Date(now - 24 * 60 * 60_000) } },
    select: { createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  if (recent[0] && now - recent[0].createdAt.getTime() < GAP_MS) {
    return { ok: false, status: 429, error: "Wait a minute before asking for another code." };
  }
  if (recent.length >= MAX_PER_DAY) {
    return { ok: false, status: 429, error: "Too many codes today. Try again tomorrow." };
  }

  // randomInt's upper bound is exclusive, so this is 000000 to 999999.
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");

  await prisma.$transaction([
    // Retire any live code for this phone and purpose, so only the newest works.
    prisma.phoneCode.updateMany({
      where: { phone, purpose, usedAt: null },
      data: { usedAt: new Date(now) },
    }),
    prisma.phoneCode.create({
      data: {
        phone,
        purpose,
        codeHash: await bcrypt.hash(code, 10),
        expiresAt: new Date(now + CODE_MINUTES * 60_000),
      },
    }),
  ]);

  return { ok: true, code };
}

/**
 * Check a code and, if it is right, use it up.
 *
 * A wrong code counts against the code's tries. The same answer is given for
 * a wrong, expired, used or missing code, so a caller cannot learn which one
 * it was.
 */
export async function useCode(phone: string, purpose: CodePurpose, code: string): Promise<boolean> {
  const row = await prisma.phoneCode.findFirst({
    where: { phone, purpose, usedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!row || row.expiresAt < new Date() || row.attempts >= MAX_WRONG_TRIES) return false;

  if (!(await bcrypt.compare(code, row.codeHash))) {
    // Atomic increment, so two guesses sent together both count.
    await prisma.phoneCode.update({
      where: { id: row.id },
      data: { attempts: { increment: 1 } },
    });
    return false;
  }

  // Mark it used only if nobody else used it in the meantime. If two correct
  // requests arrive together, exactly one of them wins.
  const claimed = await prisma.phoneCode.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  return claimed.count === 1;
}
