import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { GENESIS_HASH, canonicalPayload, computeHash, type SealedPayload } from "../src/lib/hashChain";
import {
  acceptedMessage,
  confirmPaymentMessage,
  confirmWorkMessage,
  confirmedReceipt,
  disputedReceipt,
  offerMessage,
  shortRef,
  type Language,
} from "../src/lib/sms";
import { seedAllowed } from "./seed-guard";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

/** Every development account uses this PIN. Never used outside the seed. */
const DEMO_PIN = "1234";

/**
 * Demo data covering the four situations that matter:
 *
 *   1. Bijoy Das    - accepted, worked, part paid. Money still owed.
 *   2. Sanjay Kumar - accepted, worked, paid in full, but has an OPEN complaint
 *                     that turns out to be mistaken. This is the hard case: a
 *                     complaint where the contractor did nothing wrong, and the
 *                     records prove it.
 *   3. Pramod Nayak - accepted, worked 15 days, paid NOTHING. The clearest
 *                     wage-theft case, with an open complaint.
 *   4. Rekha Munda  - has a PENDING offer waiting for a reply, so the accept flow
 *                     can be demonstrated live without creating anything first.
 */

let previousHash = GENESIS_HASH;
let chainIndex = 0;

async function seal(input: {
  recordType: SealedPayload["type"];
  recordId: string;
  workerId: string;
  summary: string;
  payload: SealedPayload;
  createdAt: Date;
}) {
  const payload = canonicalPayload(input.payload);
  const currentHash = computeHash(previousHash, payload);

  const link = await prisma.ledgerEntry.create({
    data: {
      chainIndex,
      recordType: input.recordType,
      recordId: input.recordId,
      workerId: input.workerId,
      summary: input.summary,
      payload,
      createdAt: input.createdAt,
      previousHash,
      currentHash,
    },
  });

  previousHash = currentHash;
  chainIndex += 1;
  return link;
}

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

/**
 * Keep the English copy of a message only when the worker's language is not
 * already English, so an English-speaking worker's messages carry no pointless
 * duplicate and the phone page shows no translate control for them.
 */
const englishCopy = (english: string, language: string) => (language === "en" ? null : english);

async function main() {
  // ADR-0014: this deletes every user, so it must never reach a real database.
  const guard = seedAllowed(process.env.DATABASE_URL, process.env.NODE_ENV);
  if (!guard.ok) {
    throw new Error(`Seed refused. ${guard.reason}`);
  }

  // Clear in dependency order so re-running is safe.
  await prisma.complaintAction.deleteMany();
  await prisma.complaint.deleteMany();
  await prisma.smsMessage.deleteMany();
  await prisma.ledgerEntry.deleteMany();
  // HandoverCode has no foreign key to WorkOffer, so nothing deletes it on
  // cascade. Left out of this list, used-up codes from earlier testing survived
  // every reseed and pointed at offers that no longer existed.
  await prisma.handoverCode.deleteMany();
  // Neither of these has a cascade path that a User or WorkOffer delete reaches
  // first, so both must be cleared explicitly or rows survive every reseed.
  await prisma.disputeReview.deleteMany();
  await prisma.employerStatement.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.workPeriod.deleteMany();
  await prisma.workOffer.deleteMany();
  await prisma.place.deleteMany();
  await prisma.user.deleteMany();

  previousHash = GENESIS_HASH;
  chainIndex = 0;

  const pin = await bcrypt.hash(DEMO_PIN, 10);

  // --- people -------------------------------------------------------------
  // Each location is a chosen town (ADR-0011), stored with the name Photon gives
  // for that point, so the page shows it without a lookup. Never live GPS.
  const ramesh = await prisma.user.create({
    data: {
      name: "Ramesh Pillai",
      phone: "9000010001",
      role: "CONTRACTOR",
      pin,
      company: "Ramesh Builders",
      homeState: "Kerala",
      language: "ml",
      looking: true,
      latitude: 9.9816,
      longitude: 76.2999,
      locationName: "Elamkulam",
      preferredWorkType: "Painting",
    },
  });

  const suresh = await prisma.user.create({
    data: {
      name: "Suresh Menon",
      phone: "9000010002",
      role: "CONTRACTOR",
      pin,
      company: "Sunrise Plywood Works",
      homeState: "Kerala",
      language: "ml",
      looking: false,
      latitude: 10.0261,
      longitude: 76.3125,
      locationName: "Edappally",
      preferredWorkType: "Plywood",
    },
  });

  const officer = await prisma.user.create({
    data: {
      name: "Anita Joseph",
      phone: "9000020001",
      role: "AUTHORITY",
      pin,
      company: "District Labour Office, Ernakulam",
      homeState: "Kerala",
      language: "ml",
    },
  });

  const bijoy = await prisma.user.create({
    data: {
      name: "Bijoy Das",
      phone: "9880030001",
      role: "WORKER",
      pin,
      homeState: "West Bengal",
      language: "bn",
      looking: true,
      latitude: 9.975,
      longitude: 76.29,
      locationName: "Gandhi Nagar",
      preferredWorkType: "Painting",
    },
  });

  const sanjay = await prisma.user.create({
    data: {
      name: "Sanjay Kumar",
      phone: "9880030002",
      role: "WORKER",
      pin,
      homeState: "Bihar",
      language: "hi",
      looking: true,
      latitude: 9.99,
      longitude: 76.31,
      locationName: "Pallinada",
      preferredWorkType: "Construction - shuttering",
    },
  });

  const pramod = await prisma.user.create({
    data: {
      name: "Pramod Nayak",
      phone: "9880030003",
      role: "WORKER",
      pin,
      homeState: "Odisha",
      language: "or",
      looking: false,
      latitude: 10.015,
      longitude: 76.34,
      locationName: "Kakkanad",
      preferredWorkType: "Plywood unit - press operation",
    },
  });

  const rekha = await prisma.user.create({
    data: {
      name: "Rekha Munda",
      phone: "9880030004",
      role: "WORKER",
      pin,
      homeState: "Jharkhand",
      language: "hi",
      looking: true,
      latitude: 9.97,
      longitude: 76.28,
      locationName: "Shenoys",
      preferredWorkType: "Plywood unit - grading and stacking",
    },
  });

  // --- public listings (businesses, not jobs) -------------------------------
  await prisma.place.createMany({
    data: [
      {
        name: "Example Interlock Works",
        category: "interlock",
        phone: "0484234567",
        latitude: 9.99,
        longitude: 76.31,
        source: "public_listing",
      },
      {
        name: "Kochi Timber Depot",
        category: "plywood",
        phone: "0484234987",
        latitude: 10.015,
        longitude: 76.34,
        source: "public_listing",
      },
    ],
  });

  /**
   * Create an offer, seal it, and send the SMS - the same sequence the API
   * performs, so the seeded data is indistinguishable from data created live.
   */
  async function makeOffer(input: {
    worker: typeof bijoy;
    contractor: typeof ramesh;
    dailyRate: number;
    workType: string;
    siteName: string;
    startDate: string;
    expectedDays: number;
    extraTerms?: string;
    sentOn: string;
  }) {
    const offer = await prisma.workOffer.create({
      data: {
        workerId: input.worker.id,
        contractorId: input.contractor.id,
        dailyRate: input.dailyRate,
        workType: input.workType,
        siteName: input.siteName,
        startDate: d(input.startDate),
        expectedDays: input.expectedDays,
        extraTerms: input.extraTerms ?? null,
        status: "PENDING",
        createdAt: d(input.sentOn),
      },
    });

    const link = await seal({
      recordType: "OFFER",
      recordId: offer.id,
      workerId: input.worker.id,
      summary: `Offer sent: Rs ${input.dailyRate.toFixed(2)}/day, ${input.workType}, ${input.siteName}`,
      createdAt: d(input.sentOn),
      payload: {
        type: "OFFER",
        workerId: input.worker.id,
        contractorId: input.contractor.id,
        dailyRate: input.dailyRate,
        workType: input.workType,
        siteName: input.siteName,
        startDate: d(input.startDate).toISOString(),
        expectedDays: input.expectedDays,
        extraTerms: input.extraTerms ?? "",
      },
    });

    const ref = shortRef(link.currentHash);
    const offerText = {
      workerName: input.worker.name,
      contractorName: input.contractor.name,
      company: input.contractor.company,
      dailyRate: input.dailyRate,
      workType: input.workType,
      siteName: input.siteName,
      expectedDays: input.expectedDays,
      ref,
    };

    await prisma.smsMessage.create({
      data: {
        userId: input.worker.id,
        direction: "OUT",
        kind: "OFFER",
        reference: ref,
        language: input.worker.language,
        createdAt: d(input.sentOn),
        body: offerMessage(offerText, input.worker.language as Language),
        bodyEn: englishCopy(offerMessage(offerText, "en"), input.worker.language),
      },
    });

    return { offer, ref };
  }

  /** Accept an offer: record the reply, seal the acceptance, send the receipt. */
  async function accept(offerId: string, worker: typeof bijoy, via: "SMS" | "WEB", on: string, ref: string) {
    const acceptedAt = d(on);
    const offer = await prisma.workOffer.update({
      where: { id: offerId },
      data: { status: "ACCEPTED", respondedAt: acceptedAt, respondedVia: via },
    });

    if (via === "SMS") {
      await prisma.smsMessage.create({
        data: {
          userId: worker.id,
          direction: "IN",
          kind: "REPLY",
          reference: ref,
          language: "en",
          body: `YES ${ref}`,
          createdAt: acceptedAt,
        },
      });
    }

    const link = await seal({
      recordType: "ACCEPT",
      recordId: offer.id,
      workerId: worker.id,
      summary: `${worker.name} accepted Rs ${offer.dailyRate.toFixed(2)}/day at ${offer.siteName} (by ${via === "SMS" ? "SMS" : "website"})`,
      createdAt: acceptedAt,
      payload: {
        type: "ACCEPT",
        offerId: offer.id,
        workerId: worker.id,
        dailyRate: offer.dailyRate,
        workType: offer.workType,
        siteName: offer.siteName,
        acceptedAt: acceptedAt.toISOString(),
        via,
      },
    });

    const acceptRef = shortRef(link.currentHash);
    const acceptText = {
      dailyRate: offer.dailyRate,
      siteName: offer.siteName,
      ref: acceptRef,
    };
    await prisma.smsMessage.create({
      data: {
        userId: worker.id,
        direction: "OUT",
        kind: "ACCEPTED",
        reference: acceptRef,
        language: worker.language,
        createdAt: acceptedAt,
        body: acceptedMessage(acceptText, worker.language as Language),
        bodyEn: englishCopy(acceptedMessage(acceptText, "en"), worker.language),
      },
    });

    return offer;
  }

  /**
   * Log a stretch of work and model the worker's answer.
   *
   * `confirm` is what makes the seeded data honest:
   *   "CONFIRMED" - worker replied OK. Agreed by both sides.
   *   "WAITING"   - recorded but not yet answered. Counted separately.
   *   "DISPUTED"  - worker replied WRONG, with their own figure.
   */
  async function addWork(
    offerId: string,
    worker: typeof bijoy,
    contractor: typeof ramesh,
    from: string,
    to: string,
    days: number,
    confirm: "CONFIRMED" | "WAITING" | "DISPUTED",
    opts?: { note?: string; workerDays?: number; disputeNote?: string; via?: "SMS" | "WEB" },
  ) {
    const via = opts?.via ?? "SMS";
    const period = await prisma.workPeriod.create({
      data: {
        offerId,
        fromDate: d(from),
        toDate: d(to),
        days,
        note: opts?.note ?? null,
        createdAt: d(to),
      },
    });

    const workLink = await seal({
      recordType: "WORK",
      recordId: period.id,
      workerId: worker.id,
      summary: `${worker.name} worked ${days} day${days === 1 ? "" : "s"} (${from} to ${to})`,
      createdAt: d(to),
      payload: {
        type: "WORK",
        offerId,
        workerId: worker.id,
        fromDate: d(from).toISOString(),
        toDate: d(to).toISOString(),
        days,
        note: opts?.note ?? "",
      },
    });

    // The contractor's record triggers a confirmation request to the worker.
    const askRef = shortRef(workLink.currentHash);
    const askText = {
      days,
      fromDate: from,
      toDate: to,
      contractorName: contractor.name,
      ref: askRef,
    };
    await prisma.smsMessage.create({
      data: {
        userId: worker.id,
        direction: "OUT",
        kind: "CONFIRM_WORK",
        reference: askRef,
        language: worker.language,
        createdAt: d(to),
        body: confirmWorkMessage(askText, worker.language as Language),
        bodyEn: englishCopy(confirmWorkMessage(askText, "en"), worker.language),
      },
    });

    if (confirm === "WAITING") return period;

    const answeredAt = new Date(d(to).getTime() + 6 * 60 * 60 * 1000);
    const description = `${days} day${days === 1 ? "" : "s"} (${from} to ${to})`;
    const confirmed = confirm === "CONFIRMED";
    const workerDays = confirmed ? days : (opts?.workerDays ?? 0);

    await prisma.workPeriod.update({
      where: { id: period.id },
      data: {
        confirmState: confirm,
        confirmedAt: answeredAt,
        confirmedVia: via,
        workerClaimsDays: confirmed ? null : workerDays,
        disputeNote: confirmed ? null : opts?.disputeNote ?? null,
      },
    });

    // The worker's reply, as it would arrive by SMS.
    await prisma.smsMessage.create({
      data: {
        userId: worker.id,
        direction: "IN",
        kind: "REPLY",
        reference: askRef,
        language: "en",
        createdAt: answeredAt,
        body: `${confirmed ? "OK" : "WRONG"} ${askRef}`,
      },
    });

    const answerLink = await seal({
      recordType: confirmed ? "CONFIRM" : "DISPUTE",
      recordId: `WORK:${period.id}`,
      workerId: worker.id,
      summary: confirmed
        ? `Worker confirmed ${description} is correct (by ${via === "SMS" ? "SMS" : "website"})`
        : `Worker says ${description} is wrong — claims ${workerDays} days (by ${via === "SMS" ? "SMS" : "website"})`,
      createdAt: answeredAt,
      payload: confirmed
        ? {
            type: "CONFIRM",
            targetType: "WORK",
            targetId: period.id,
            workerId: worker.id,
            value: days,
            confirmedAt: answeredAt.toISOString(),
            via,
          }
        : {
            type: "DISPUTE",
            targetType: "WORK",
            targetId: period.id,
            workerId: worker.id,
            contractorValue: days,
            workerValue: workerDays,
            note: opts?.disputeNote ?? "",
            disputedAt: answeredAt.toISOString(),
            via,
          },
    });

    const receiptRef = shortRef(answerLink.currentHash);
    await prisma.smsMessage.create({
      data: {
        userId: worker.id,
        direction: "OUT",
        kind: confirmed ? "CONFIRMED" : "DISPUTED",
        reference: receiptRef,
        language: worker.language,
        createdAt: answeredAt,
        body: confirmed
          ? confirmedReceipt({ what: description, ref: receiptRef }, worker.language as Language)
          : disputedReceipt({ what: description, ref: receiptRef }, worker.language as Language),
        bodyEn: englishCopy(
          confirmed
            ? confirmedReceipt({ what: description, ref: receiptRef }, "en")
            : disputedReceipt({ what: description, ref: receiptRef }, "en"),
          worker.language,
        ),
      },
    });

    return period;
  }

  async function addPayment(
    offerId: string,
    worker: typeof bijoy,
    contractor: typeof ramesh,
    amount: number,
    paidOn: string,
    method: string,
    note: string,
    confirm: "CONFIRMED" | "WAITING" | "DISPUTED",
    opts?: {
      workerAmount?: number;
      disputeNote?: string;
      via?: "SMS" | "WEB" | "CODE";
      /** NONE | CODE | REFERENCE - how strongly the handover can be shown. */
      proof?: "NONE" | "CODE" | "REFERENCE";
      proofReference?: string;
    },
  ) {
    const via = opts?.via ?? "SMS";
    const proof = opts?.proof ?? "NONE";
    const payment = await prisma.payment.create({
      data: {
        offerId,
        amount,
        paidOn: d(paidOn),
        method,
        note,
        createdAt: d(paidOn),
        proofType: proof,
        proofReference: opts?.proofReference ?? null,
        proofAt: proof === "NONE" ? null : d(paidOn),
      },
    });

    const payLink = await seal({
      recordType: "PAYMENT",
      recordId: payment.id,
      workerId: worker.id,
      summary: `Paid Rs ${amount.toFixed(2)} to ${worker.name} by ${method}`,
      createdAt: d(paidOn),
      payload: {
        type: "PAYMENT",
        offerId,
        workerId: worker.id,
        amount,
        paidOn: d(paidOn).toISOString(),
        method,
        note,
      },
    });

    const askRef = shortRef(payLink.currentHash);
    const payAskText = { amount, paidOn, contractorName: contractor.name, ref: askRef };
    await prisma.smsMessage.create({
      data: {
        userId: worker.id,
        direction: "OUT",
        kind: "CONFIRM_PAYMENT",
        reference: askRef,
        language: worker.language,
        createdAt: d(paidOn),
        body: confirmPaymentMessage(payAskText, worker.language as Language),
        bodyEn: englishCopy(confirmPaymentMessage(payAskText, "en"), worker.language),
      },
    });

    if (confirm === "WAITING") return payment;

    const answeredAt = new Date(d(paidOn).getTime() + 4 * 60 * 60 * 1000);
    const description = `payment of Rs ${amount.toFixed(0)} on ${paidOn}`;
    const confirmed = confirm === "CONFIRMED";
    const workerAmount = confirmed ? amount : (opts?.workerAmount ?? 0);

    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        confirmState: confirm,
        confirmedAt: answeredAt,
        confirmedVia: via,
        workerClaimsAmount: confirmed ? null : workerAmount,
        disputeNote: confirmed ? null : opts?.disputeNote ?? null,
      },
    });

    await prisma.smsMessage.create({
      data: {
        userId: worker.id,
        direction: "IN",
        kind: "REPLY",
        reference: askRef,
        language: "en",
        createdAt: answeredAt,
        body: `${confirmed ? "OK" : "WRONG"} ${askRef}`,
      },
    });

    const answerLink = await seal({
      recordType: confirmed ? "CONFIRM" : "DISPUTE",
      recordId: `PAYMENT:${payment.id}`,
      workerId: worker.id,
      summary: confirmed
        ? `Worker confirmed ${description} is correct (by ${via === "SMS" ? "SMS" : "website"})`
        : `Worker says ${description} is wrong — claims Rs ${workerAmount.toFixed(0)} (by ${via === "SMS" ? "SMS" : "website"})`,
      createdAt: answeredAt,
      payload: confirmed
        ? {
            type: "CONFIRM",
            targetType: "PAYMENT",
            targetId: payment.id,
            workerId: worker.id,
            value: amount,
            confirmedAt: answeredAt.toISOString(),
            via,
          }
        : {
            type: "DISPUTE",
            targetType: "PAYMENT",
            targetId: payment.id,
            workerId: worker.id,
            contractorValue: amount,
            workerValue: workerAmount,
            note: opts?.disputeNote ?? "",
            disputedAt: answeredAt.toISOString(),
            via,
          },
    });

    const receiptRef = shortRef(answerLink.currentHash);
    await prisma.smsMessage.create({
      data: {
        userId: worker.id,
        direction: "OUT",
        kind: confirmed ? "CONFIRMED" : "DISPUTED",
        reference: receiptRef,
        language: worker.language,
        createdAt: answeredAt,
        body: confirmed
          ? confirmedReceipt({ what: description, ref: receiptRef }, worker.language as Language)
          : disputedReceipt({ what: description, ref: receiptRef }, worker.language as Language),
        bodyEn: englishCopy(
          confirmed
            ? confirmedReceipt({ what: description, ref: receiptRef }, "en")
            : disputedReceipt({ what: description, ref: receiptRef }, "en"),
          worker.language,
        ),
      },
    });

    return payment;
  }

  // -----------------------------------------------------------------------
  // 1. Bijoy Das - accepted by SMS, worked 23 days, part paid. Rs 3,550 owed.
  // -----------------------------------------------------------------------
  const b = await makeOffer({
    worker: bijoy,
    contractor: ramesh,
    dailyRate: 850,
    workType: "Construction - steel binding",
    siteName: "Kakkanad Phase 2",
    startDate: "2026-07-06",
    expectedDays: 26,
    extraTerms: "Overtime after 8 hours at Rs 120/hour. Accommodation provided.",
    sentOn: "2026-07-04",
  });
  await accept(b.offer.id, bijoy, "SMS", "2026-07-04", b.ref);
  // Most weeks confirmed by the worker, one still waiting - which is the normal
  // state of a live system and shows the interface handling both.
  await addWork(b.offer.id, bijoy, ramesh, "2026-07-06", "2026-07-11", 6, "CONFIRMED");
  await addWork(b.offer.id, bijoy, ramesh, "2026-07-13", "2026-07-18", 5.5, "CONFIRMED", {
    note: "half day Thursday - rain",
  });
  // Cash, but with a handover code read back at the time. Provable.
  await addPayment(b.offer.id, bijoy, ramesh, 8000, "2026-07-18", "CASH", "part payment, first two weeks", "CONFIRMED", {
    proof: "CODE",
    via: "CODE",
  });
  await addWork(b.offer.id, bijoy, ramesh, "2026-07-20", "2026-07-25", 6, "CONFIRMED");
  await addWork(b.offer.id, bijoy, ramesh, "2026-07-27", "2026-08-01", 5.5, "WAITING", {
    note: "left early Friday - clinic",
  });
  // Cash with no proof attached, confirmed later from memory by SMS. Weaker, and
  // labelled as such - this is what most cash payments look like in practice.
  await addPayment(b.offer.id, bijoy, ramesh, 8000, "2026-08-01", "CASH", "part payment, weeks three and four", "CONFIRMED");

  // -----------------------------------------------------------------------
  // 2. Sanjay Kumar - accepted on the website, worked 12 days, PAID IN FULL,
  //    but has filed a complaint claiming he is owed two more days.
  //
  //    This is the case worth demonstrating. The records show 12 days and
  //    Rs 9,600 paid at the agreed Rs 800/day - so the complaint is mistaken.
  //    The system does not decide that; it gives the officer the figures to see
  //    it, and the officer closes the case with a reason. Without records this
  //    argument has no ending.
  // -----------------------------------------------------------------------
  const s = await makeOffer({
    worker: sanjay,
    contractor: ramesh,
    dailyRate: 800,
    workType: "Construction - shuttering",
    siteName: "Kakkanad Phase 2",
    startDate: "2026-07-13",
    expectedDays: 12,
    sentOn: "2026-07-11",
  });
  await accept(s.offer.id, sanjay, "WEB", "2026-07-12", s.ref);
  // Both weeks confirmed by Sanjay himself, and the payment too. This is what
  // makes his later complaint answerable: he agreed to these figures at the time.
  await addWork(s.offer.id, sanjay, ramesh, "2026-07-13", "2026-07-18", 6, "CONFIRMED", { via: "WEB" });
  await addWork(s.offer.id, sanjay, ramesh, "2026-07-20", "2026-07-25", 6, "CONFIRMED", { via: "WEB" });
  // UPI with the transaction id stored. Strongest evidence, because the trail is
  // at the bank and neither party controls it.
  await addPayment(s.offer.id, sanjay, ramesh, 9600, "2026-07-28", "UPI", "full settlement, 12 days", "CONFIRMED", {
    via: "WEB",
    proof: "REFERENCE",
    proofReference: "UPI/427193006621",
  });

  // -----------------------------------------------------------------------
  // 3. Pramod Nayak - accepted by SMS, worked 15 days, paid nothing.
  // -----------------------------------------------------------------------
  const p = await makeOffer({
    worker: pramod,
    contractor: suresh,
    dailyRate: 700,
    workType: "Plywood unit - press operation",
    siteName: "Perumbavoor Unit 4",
    startDate: "2026-07-20",
    expectedDays: 20,
    extraTerms: "Payment every Saturday.",
    sentOn: "2026-07-18",
  });
  await accept(p.offer.id, pramod, "SMS", "2026-07-19", p.ref);
  await addWork(p.offer.id, pramod, suresh, "2026-07-20", "2026-07-25", 6, "CONFIRMED");
  await addWork(p.offer.id, pramod, suresh, "2026-07-27", "2026-08-01", 6, "CONFIRMED");
  // The understated week: Pramod worked 6 days, the contractor recorded 3, and
  // Pramod rejected it. This is the case the confirmation design exists for - the
  // record chain alone would have sealed the 3 days as permanent truth.
  await addWork(p.offer.id, pramod, suresh, "2026-08-03", "2026-08-08", 3, "DISPUTED", {
    workerDays: 6,
    disputeNote: "I worked all six days that week. Only three are written down.",
  });

  // The unprovable case, seeded on purpose.
  //
  // Suresh records Rs 4,000 cash to Pramod with no code and no reference. Pramod
  // says he never received it. Both statements are plausible and NOTHING in the
  // system can settle it - which is exactly why the officer needs the UNPROVEN
  // outcome and the track-record panel.
  //
  // This is the case to demonstrate when someone asks "what if the contractor is
  // honest and the worker lies?"
  await addPayment(
    p.offer.id,
    pramod,
    suresh,
    4000,
    "2026-08-06",
    "CASH",
    "advance handed over at the unit",
    "DISPUTED",
    {
      proof: "NONE",
      workerAmount: 0,
      disputeNote: "I never received this money. Nobody gave me anything on that day.",
    },
  );

  // -----------------------------------------------------------------------
  // 4. Rekha Munda - a PENDING offer, so the accept flow can be shown live.
  // -----------------------------------------------------------------------
  await makeOffer({
    worker: rekha,
    contractor: suresh,
    dailyRate: 750,
    workType: "Plywood unit - grading and stacking",
    siteName: "Perumbavoor Unit 4",
    startDate: "2026-08-24",
    expectedDays: 18,
    extraTerms: "Shared accommodation. One rest day per week.",
    sentOn: "2026-08-22",
  });

  // --- complaints ---------------------------------------------------------

  // Pramod: the genuine case. Fifteen days, nothing paid.
  const pramodComplaint = await prisma.complaint.create({
    data: {
      offerId: p.offer.id,
      raisedById: pramod.id,
      category: "UNPAID",
      description:
        "I have worked 15 days at the plywood unit and received no payment at all. The supervisor keeps saying next week. I need to send money home.",
      language: "or",
      claimedAmount: 10500,
      status: "OPEN",
      createdAt: d("2026-08-10"),
    },
  });

  // Sanjay: the mistaken case, already asked and answered, still open for the
  // officer to close during the demo.
  const sanjayComplaint = await prisma.complaint.create({
    data: {
      offerId: s.offer.id,
      raisedById: sanjay.id,
      category: "DAYS_DISPUTE",
      description:
        "I think two days are missing from my payment. I counted 14 days but the payment was for 12.",
      language: "hi",
      claimedAmount: 1600,
      status: "OPEN",
      createdAt: d("2026-08-02"),
    },
  });

  await prisma.complaintAction.create({
    data: {
      complaintId: sanjayComplaint.id,
      authorId: officer.id,
      kind: "ASKED_EMPLOYER",
      note: "Worker says two days are missing. Please check your site register against the recorded work periods and respond.",
      createdAt: d("2026-08-03"),
    },
  });

  await prisma.complaintAction.create({
    data: {
      complaintId: sanjayComplaint.id,
      authorId: ramesh.id,
      kind: "EMPLOYER_REPLY",
      note: "The site register shows 12 working days for Sanjay between 13 and 25 July. The two days he is counting are the Sundays, which were rest days and not worked. Both work periods were recorded on the system at the time.",
      createdAt: d("2026-08-04"),
    },
  });

  console.log("Seed complete.\n");

  const counts = {
    users: await prisma.user.count(),
    offers: await prisma.workOffer.count(),
    records: await prisma.ledgerEntry.count(),
    messages: await prisma.smsMessage.count(),
    complaints: await prisma.complaint.count(),
  };

  console.log(`  people:     ${counts.users}`);
  console.log(`  contracts:  ${counts.offers}  (3 accepted, 1 waiting for a reply)`);
  console.log(`  records:    ${counts.records}  (offers, acceptances, work, payments)`);
  console.log(`  messages:   ${counts.messages}`);
  console.log(`  complaints: ${counts.complaints}\n`);

  const waitingWork = await prisma.workPeriod.count({ where: { confirmState: "WAITING" } });
  const disputedWork = await prisma.workPeriod.count({ where: { confirmState: "DISPUTED" } });

  console.log("  Situation of each worker:");
  console.log("    Bijoy Das     Rs 850/day, 23 days, Rs 16,000 paid  -> Rs 3,550 owed");
  console.log("                  (one week still waiting for him to confirm)");
  console.log("    Sanjay Kumar  Rs 800/day, 12 days, Rs 9,600 paid   -> settled");
  console.log("                  (he confirmed every record himself, then complained anyway)");
  console.log("    Pramod Nayak  Rs 700/day, 15 days, nothing paid    -> Rs 10,500 owed");
  console.log("                  (contractor wrote 3 days for a 6-day week; Pramod rejected it)");
  console.log("    Rekha Munda   offer of Rs 750/day waiting for her reply\n");
  console.log(`  Confirmation state: ${waitingWork} record(s) waiting, ${disputedWork} rejected by the worker\n`);

  console.log(`  Sign in with a phone number and the PIN ${DEMO_PIN}:`);
  console.log("    9880030001  Bijoy Das      worker    West Bengal, Bengali");
  console.log("    9880030002  Sanjay Kumar   worker    Bihar, Hindi");
  console.log("    9880030003  Pramod Nayak   worker    Odisha, Odia");
  console.log("    9880030004  Rekha Munda    worker    Jharkhand, Hindi");
  console.log("    9000010001  Ramesh Pillai  contractor  Ramesh Builders");
  console.log("    9000010002  Suresh Menon   contractor  Sunrise Plywood Works");
  console.log("    9000020001  Anita Joseph   labour officer, Ernakulam");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
