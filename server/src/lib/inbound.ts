import { prisma } from "./prisma";
import {
  balanceMessage,
  getSmsProvider,
  getTextbeeApiKey,
  helpMessage,
  isFakeProvider,
  parseReply,
  send,
  shortRef,
  type Language,
} from "./sms";
import { computeBalance } from "./ledger";
import { findPendingByRef, respondToRecord } from "./confirmations";
import { respondToOffer } from "../routes/offers";

/**
 * ===========================================================================
 * Applying an inbound SMS reply.
 * ===========================================================================
 *
 * Why this file exists separately from the poll in `sms.ts`:
 *
 * Storing the worker's reply is not the same as acting on it. The first version
 * of the poll only wrote an audit row, so a worker who replied "YES 5804" from
 * their own handset saw nothing happen: the offer stayed PENDING and the
 * acceptance was never sealed. The website route worked and the real phone did
 * not, which is the opposite of the product's claim that SMS is a real client.
 *
 * So the poll now runs the same functions the website calls - `respondToOffer`
 * and `respondToRecord` - which is what keeps the two channels from drifting
 * apart. A worker's YES means exactly the same thing however it arrives.
 */

/** Find the worker's own offer that a 4-digit code refers to. */
async function findOfferByRef(
  workerId: string,
  ref: string | undefined,
  status: string,
): Promise<string | null> {
  const candidates = await prisma.workOffer.findMany({
    where: { workerId, status },
    select: { id: true },
  });

  for (const c of candidates) {
    const link = await prisma.ledgerEntry.findFirst({
      where: { recordType: "OFFER", recordId: c.id },
      select: { currentHash: true },
    });
    if (link && shortRef(link.currentHash) === ref) return c.id;
  }

  // No code given. One pending offer is unambiguous, so a bare "YES" works.
  // More than one, and guessing could accept the wrong contract.
  if (!ref && candidates.length === 1) return candidates[0]!.id;
  return null;
}

/**
 * Poll Textbee, store each new reply, and apply it.
 *
 * Returns how many replies changed a record, so the caller can log something
 * meaningful. A stored-but-not-understood message counts as zero.
 */
export async function pollAndApplyInbound(): Promise<number> {
  const provider = getSmsProvider();
  if (!provider.fetchInbound) return 0;
  if (!isFakeProvider() && !getTextbeeApiKey()) return 0;

  const inbound = await provider.fetchInbound();
  let applied = 0;

  for (const msg of inbound) {
    const digits = msg.from.replace(/\D/g, "").slice(-10);
    if (digits.length !== 10) continue;

    const user = await prisma.user.findUnique({ where: { phone: digits } });
    if (!user) continue;

    // Dedupe on the provider's message id, never on the body text.
    //
    // A worker whose first reply appeared to do nothing will send the same
    // words again. Matching on text would skip that second message and leave
    // the offer PENDING for ever, which is exactly the failure this poll is
    // meant to remove. Without an id we cannot tell a resend from a duplicate
    // poll, so the body check is kept only as the fallback.
    if (msg.id) {
      const seen = await prisma.smsMessage.findFirst({
        where: { userId: user.id, direction: "IN", providerId: msg.id },
      });
      if (seen) continue;
    } else {
      const seen = await prisma.smsMessage.findFirst({
        where: { userId: user.id, direction: "IN", body: msg.body, providerId: null },
      });
      if (seen) continue;
    }

    const reply = parseReply(msg.body);

    // Store what arrived, whatever it says, so the audit log is honest.
    await prisma.smsMessage.create({
      data: {
        userId: user.id,
        direction: "IN",
        body: msg.body,
        language: "en",
        kind: "REPLY",
        reference: reply.ref ?? null,
        providerId: msg.id ?? null,
        status: "received",
      },
    });

    // Only a worker can answer an offer or a record.
    if (user.role !== "WORKER") continue;

    const language = (user.language ?? "en") as Language;

    if (reply.intent === "ACCEPT" || reply.intent === "DECLINE") {
      const offerId = await findOfferByRef(user.id, reply.ref, "PENDING");
      if (!offerId) continue;

      await respondToOffer({ offerId, decision: reply.intent, via: "SMS" });
      applied += 1;
      continue;
    }

    if (reply.intent === "CONFIRM" || reply.intent === "REJECT") {
      const target = await findPendingByRef(user.id, reply.ref);
      if (!target) continue;

      const result = await respondToRecord({
        workerId: user.id,
        targetType: target.targetType,
        targetId: target.targetId,
        decision: reply.intent === "CONFIRM" ? "CONFIRM" : "REJECT",
        via: "SMS",
        workerValue: 0,
        note:
          reply.intent === "REJECT"
            ? "Rejected by SMS. The worker's own figure still needs to be collected by phone."
            : undefined,
      });
      if (result.ok) applied += 1;
      continue;
    }

    if (reply.intent === "BALANCE") {
      const offers = await prisma.workOffer.findMany({
        where: { workerId: user.id, status: "ACCEPTED" },
        select: { id: true },
      });

      for (const o of offers) {
        const b = await computeBalance(o.id);
        if (!b) continue;
        const link = await prisma.ledgerEntry.findFirst({
          where: { recordType: "ACCEPT", recordId: o.id },
          select: { currentHash: true },
        });
        const ref = link ? shortRef(link.currentHash) : "0000";
        const balText = {
          siteName: b.siteName,
          dailyRate: b.dailyRate,
          daysWorked: b.daysWorked,
          paid: b.paid,
          balance: b.balance,
          ref,
        };
        await send({
          userId: user.id,
          kind: "BALANCE",
          reference: ref,
          language,
          body: balanceMessage(balText, language),
          bodyEn: balanceMessage(balText, "en"),
        });
      }
      applied += 1;
      continue;
    }

    // Not understood. Reply with the valid options rather than guessing,
    // because a wrong guess would create a binding record from a misread
    // message.
    await send({
      userId: user.id,
      kind: "OFFER",
      language,
      body: helpMessage(language),
      bodyEn: helpMessage("en"),
    });
  }

  return applied;
}
