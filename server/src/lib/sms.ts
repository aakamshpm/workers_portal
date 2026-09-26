import { prisma } from "./prisma";

/**
 * ===========================================================================
 * SMS via Textbee (ADR-0008)
 * ===========================================================================
 *
 * Workers use the system over plain SMS on their own phone. Textbee hosted API
 * plus one Android phone as modem sends the message. Localhost first: outbound
 * is a POST from the API, inbound is a poll of Textbee. Public webhook comes
 * last.
 *
 * Every message is also written to SmsMessage as a record of what was sent and
 * received. The worker reads his messages on his own phone, so no page shows
 * this table. Inbound replies are applied by `pollAndApplyInbound` in
 * inbound.ts. Tests inject a fake provider and never call textbee.dev. If
 * TEXTBEE_API_KEY is missing, send() fails and writes no row that looks
 * delivered.
 * ===========================================================================
 */

export interface SmsSendResult {
  id: string | null;
  status: string;
}

export interface SmsInbound {
  /**
   * The provider's own message id.
   *
   * Dedupe uses this, not the body text. Two identical bodies are two real
   * messages: a worker who replied "YES 5804" and saw nothing happen will send
   * the same words again, and skipping the second one leaves the offer PENDING
   * for ever.
   */
  id?: string;
  from: string;
  body: string;
  receivedAt: string;
}

export interface SmsProvider {
  send(input: { to: string; body: string }): Promise<SmsSendResult>;
  fetchInbound?: () => Promise<SmsInbound[]>;
}

let customProvider: SmsProvider | null = null;

/** Tests inject a fake. Production uses Textbee. */
export function setSmsProvider(p: SmsProvider | null) {
  customProvider = p;
}

/** True while a fake provider is installed, so callers can skip the key check. */
export function isFakeProvider(): boolean {
  return customProvider !== null;
}

export function getTextbeeBaseUrl(): string {
  return process.env.TEXTBEE_BASE_URL ?? "https://api.textbee.dev";
}

export function getTextbeeApiKey(): string | undefined {
  return process.env.TEXTBEE_API_KEY;
}

/** Production provider that calls https://api.textbee.dev. Never used in tests. */
export class TextbeeSmsProvider implements SmsProvider {
  constructor(
    private apiKey?: string,
    private baseUrl?: string,
  ) {}

  async send(input: { to: string; body: string }): Promise<SmsSendResult> {
    const key = this.apiKey ?? getTextbeeApiKey();
    if (!key) {
      throw new Error("TEXTBEE_API_KEY is not set. Set it in server/.env");
    }
    const base = this.baseUrl ?? getTextbeeBaseUrl();
    const res = await fetch(`${base}/api/v1/gateway/send-sms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
      },
      body: JSON.stringify({ recipients: [input.to], message: input.body }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg =
        typeof (err as { error?: unknown }).error === "string"
          ? (err as { error: string }).error
          : `Textbee send failed with HTTP ${res.status}`;
      throw new Error(msg);
    }
    const data = (await res.json().catch(() => ({}))) as {
      smsBatchId?: string;
      data?: { smsBatchId?: string };
      messageId?: string;
    };
    const id = data.smsBatchId ?? data.data?.smsBatchId ?? data.messageId ?? null;
    return { id, status: "queued" };
  }

  async fetchInbound(): Promise<SmsInbound[]> {
    const key = this.apiKey ?? getTextbeeApiKey();
    if (!key) {
      throw new Error("TEXTBEE_API_KEY is not set. Set it in server/.env");
    }
    const base = this.baseUrl ?? getTextbeeBaseUrl();
    const res = await fetch(`${base}/api/v1/gateway/messages?direction=received&limit=50`, {
      headers: { "x-api-key": key },
    });
    if (!res.ok) {
      throw new Error(`Textbee poll failed with HTTP ${res.status}`);
    }
    // Textbee returns `_id`, `sender` and `message` on each received row.
    // The other names are accepted so a field rename does not break the poll.
    type TextbeeInboundRow = {
      _id?: string;
      id?: string;
      from?: string;
      sender?: string;
      body?: string;
      message?: string;
      receivedAt?: string;
      createdAt?: string;
    };
    const data = (await res.json().catch(() => ({}))) as {
      data?: TextbeeInboundRow[];
      messages?: TextbeeInboundRow[];
    };
    const list = data.data ?? data.messages ?? [];
    return list.map((m) => ({
      id: m._id ?? m.id,
      from: m.from ?? m.sender ?? "",
      body: m.body ?? m.message ?? "",
      receivedAt: m.receivedAt ?? m.createdAt ?? new Date().toISOString(),
    }));
  }
}

export function getSmsProvider(): SmsProvider {
  if (customProvider) return customProvider;
  return new TextbeeSmsProvider();
}

export type Language = "en" | "hi" | "bn" | "ml" | "or";

export const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  hi: "हिन्दी (Hindi)",
  bn: "বাংলা (Bengali)",
  ml: "മലയാളം (Malayalam)",
  or: "ଓଡ଼ିଆ (Odia)",
};

/**
 * Home state to language, used to pick a sensible default when a worker registers
 * themselves. Kerala's migrant workforce comes mainly from West Bengal, Bihar,
 * Assam, Odisha and Uttar Pradesh.
 */
export const STATE_LANGUAGE: Record<string, Language> = {
  "West Bengal": "bn",
  Bihar: "hi",
  "Uttar Pradesh": "hi",
  Jharkhand: "hi",
  Assam: "bn",
  Odisha: "or",
  Kerala: "ml",
};

export const HOME_STATES = Object.keys(STATE_LANGUAGE);

/**
 * A short code the worker quotes when replying.
 *
 * Four digits, because it has to be typed on a numeric keypad and read out over a
 * phone call. Derived from the record code so it still points at one exact record.
 */
export function shortRef(hash: string): string {
  // Take the first 4 hex characters and map into a 4-digit decimal range, so the
  // worker never has to type a letter.
  const n = parseInt(hash.slice(0, 6), 16) % 9000;
  return String(1000 + n);
}

/**
 * Send an outgoing message via Textbee, then store the audit row.
 *
 * If TEXTBEE_API_KEY is missing and no fake provider is injected, it throws
 * and writes no row that looks delivered.
 */
export async function send(input: {
  userId: string;
  body: string;
  language: string;
  kind: string;
  reference?: string;
  /**
   * The same message in English, for a reader who does not know the worker's
   * language. Callers that build the body with one of the message functions below
   * should call it a second time with "en" and pass the result here. Leave it out
   * when the body is already English.
   */
  bodyEn?: string;
}) {
  // Storing an identical copy would waste a column and make the page show a
  // pointless "translation", so only a genuinely different string is kept.
  const bodyEn = input.bodyEn && input.bodyEn !== input.body ? input.bodyEn : null;

  const provider = getSmsProvider();
  const isFake = customProvider !== null;
  if (!isFake && !getTextbeeApiKey()) {
    throw new Error("TEXTBEE_API_KEY is not set. Set it in server/.env");
  }

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { phone: true },
  });
  if (!user) throw new Error("User not found for SMS");

  // Indian numbers are stored as 10 digits. Textbee needs E.164.
  const to = user.phone.startsWith("+") ? user.phone : `+91${user.phone}`;

  const result = await provider.send({ to, body: input.body });

  return prisma.smsMessage.create({
    data: {
      userId: input.userId,
      direction: "OUT",
      body: input.body,
      bodyEn,
      language: input.language,
      kind: input.kind,
      reference: input.reference ?? null,
      providerId: result.id,
      status: result.status,
    },
  });
}


// ---------------------------------------------------------------------------
// Message text
//
// Three deliberate choices, all visible in the strings below:
//
//   - Numerals stay Western. Workers read digits on currency notes and phone
//     keypads; regional numerals would be harder, not easier.
//   - "Rs" rather than the rupee symbol, which does not render on every basic
//     handset and is mangled by some gateways.
//   - Keywords to reply with are Latin and uppercase (YES / NO), so they can be
//     typed on any keypad regardless of the message's script.
// ---------------------------------------------------------------------------

/**
 * The offer message. The most important message in the system: it puts the
 * promised rate on the worker's own phone before any work is done.
 */
export function offerMessage(
  input: {
    workerName: string;
    contractorName: string;
    company: string | null;
    dailyRate: number;
    workType: string;
    siteName: string;
    expectedDays: number;
    ref: string;
  },
  language: Language,
): string {
  const { workerName, contractorName, company, dailyRate, siteName, expectedDays, ref } = input;
  const rate = Math.round(dailyRate);
  const from = company ? `${contractorName}, ${company}` : contractorName;

  switch (language) {
    case "hi":
      return [
        `${workerName} ji, kaam ka prastaav:`,
        `${from}`,
        `Jagah: ${siteName}`,
        `Dar: Rs ${rate}/din`,
        `Din: ${expectedDays}`,
        ``,
        `Manzoor hai to bhejein: YES ${ref}`,
        `Nahi to: NO ${ref}`,
      ].join("\n");

    case "bn":
      return [
        `${workerName}, kajer prostab:`,
        `${from}`,
        `Jayga: ${siteName}`,
        `Har: Rs ${rate}/din`,
        `Din: ${expectedDays}`,
        ``,
        `Raji thakle pathan: YES ${ref}`,
        `Na hole: NO ${ref}`,
      ].join("\n");

    case "or":
      return [
        `${workerName}, kama prastaba:`,
        `${from}`,
        `Sthana: ${siteName}`,
        `Hara: Rs ${rate}/din`,
        `Dina: ${expectedDays}`,
        ``,
        `Raji thile pathantu: YES ${ref}`,
        `Nahin hele: NO ${ref}`,
      ].join("\n");

    case "ml":
      return [
        `${workerName}, joli offer:`,
        `${from}`,
        `Sthalam: ${siteName}`,
        `Nirakku: Rs ${rate}/divasam`,
        `Divasam: ${expectedDays}`,
        ``,
        `Sammatham enkil: YES ${ref}`,
        `Alla enkil: NO ${ref}`,
      ].join("\n");

    case "en":
    default:
      return [
        `${workerName}, work offer:`,
        `${from}`,
        `Site: ${siteName}`,
        `Rate: Rs ${rate}/day`,
        `Days: ${expectedDays}`,
        ``,
        `To accept, reply: YES ${ref}`,
        `To refuse, reply: NO ${ref}`,
      ].join("\n");
  }
}

/**
 * Sent the moment the worker accepts. This is their receipt, and the message the
 * project's whole argument rests on - the worker now holds the agreed rate in
 * writing, on their own phone, before any work is done.
 */
export function acceptedMessage(
  input: { dailyRate: number; siteName: string; ref: string },
  language: Language,
): string {
  const rate = Math.round(input.dailyRate);

  switch (language) {
    case "hi":
      return `Manzoor. ${input.siteName}, Rs ${rate}/din tay hua. Yeh SMS sambhal kar rakhein - yeh aapka sabooth hai. Ref ${input.ref}`;
    case "bn":
      return `Grohon kora holo. ${input.siteName}, Rs ${rate}/din thik holo. Ei SMS rekhe din - eta apnar proman. Ref ${input.ref}`;
    case "or":
      return `Grahana kara gala. ${input.siteName}, Rs ${rate}/din sthira hela. Ehi SMS rakhantu - eha apananka pramana. Ref ${input.ref}`;
    case "ml":
      return `Sweekarichu. ${input.siteName}, Rs ${rate}/divasam urappichu. Ee SMS sookshikkuka - ithu ningalude thelivaanu. Ref ${input.ref}`;
    default:
      return `Accepted. ${input.siteName} at Rs ${rate}/day. Keep this SMS - it is your proof of the agreed rate. Ref ${input.ref}`;
  }
}

export function declinedMessage(
  input: { siteName: string; ref: string },
  language: Language,
): string {
  switch (language) {
    case "hi":
      return `Aapne ${input.siteName} ka kaam mana kar diya. Koi record nahi banaya gaya. Ref ${input.ref}`;
    case "bn":
      return `Apni ${input.siteName} er kaj nakoch korechen. Kono record toiri hoyni. Ref ${input.ref}`;
    case "or":
      return `Apana ${input.siteName} kama manaa karithile. KauNasi record hoi nahin. Ref ${input.ref}`;
    case "ml":
      return `Ningal ${input.siteName} joli nirasichu. Oru record-um undakiyittilla. Ref ${input.ref}`;
    default:
      return `You refused the work at ${input.siteName}. No record has been created. Ref ${input.ref}`;
  }
}

/** Sent after each payment, so a short payment is noticed the same day. */
export function paymentMessage(
  input: { amount: number; balance: number; ref: string },
  language: Language,
): string {
  const amt = Math.round(input.amount);
  const due = Math.round(input.balance);

  switch (language) {
    case "hi":
      return `Rs ${amt} ka bhugtan darj hua. Baki: Rs ${due}. Galat ho to shikayat darj karein. Ref ${input.ref}`;
    case "bn":
      return `Rs ${amt} payment record holo. Baki: Rs ${due}. Bhul hole obhijog korun. Ref ${input.ref}`;
    case "or":
      return `Rs ${amt} deya record hela. Baki: Rs ${due}. Bhula thile abhiyoga karantu. Ref ${input.ref}`;
    case "ml":
      return `Rs ${amt} payment rekhappeduthi. Baaki: Rs ${due}. Thettanenkil parathi nalkuka. Ref ${input.ref}`;
    default:
      return `Payment of Rs ${amt} recorded. Balance due: Rs ${due}. If this is wrong, file a complaint. Ref ${input.ref}`;
  }
}

/** The balance the worker gets when they ask for it. */
export function balanceMessage(
  input: {
    siteName: string;
    dailyRate: number;
    daysWorked: number;
    paid: number;
    balance: number;
    ref: string;
  },
  language: Language,
): string {
  const rate = Math.round(input.dailyRate);
  const days = Number.isInteger(input.daysWorked)
    ? String(input.daysWorked)
    : input.daysWorked.toFixed(1);
  const paid = Math.round(input.paid);
  const due = Math.round(input.balance);

  switch (language) {
    case "hi":
      return `${input.siteName}\nDar: Rs ${rate}/din\nKaam: ${days} din\nMila: Rs ${paid}\nBaki: Rs ${due}\nRef ${input.ref}`;
    case "bn":
      return `${input.siteName}\nHar: Rs ${rate}/din\nKaj: ${days} din\nPeyechen: Rs ${paid}\nBaki: Rs ${due}\nRef ${input.ref}`;
    case "or":
      return `${input.siteName}\nHara: Rs ${rate}/din\nKama: ${days} dina\nPaichanti: Rs ${paid}\nBaki: Rs ${due}\nRef ${input.ref}`;
    case "ml":
      return `${input.siteName}\nNirakku: Rs ${rate}/div\nJoli: ${days} div\nLabhichu: Rs ${paid}\nBaaki: Rs ${due}\nRef ${input.ref}`;
    default:
      return `${input.siteName}\nRate: Rs ${rate}/day\nWorked: ${days} days\nReceived: Rs ${paid}\nBalance: Rs ${due}\nRef ${input.ref}`;
  }
}

/** A message from the labour officer, sent through the portal. */
export function authorityMessage(officerName: string, text: string, ref: string): string {
  return `Labour Dept (${officerName}): ${text} Ref ${ref}`;
}

// ---------------------------------------------------------------------------
// Reply parsing
// ---------------------------------------------------------------------------

export interface ParsedReply {
  intent: "ACCEPT" | "DECLINE" | "CONFIRM" | "REJECT" | "BALANCE" | "UNKNOWN";
  ref?: string;
}

/**
 * Read a worker's SMS reply.
 *
 * Written to be forgiving, because it has to work with a real person typing on a
 * numeric keypad in a hurry:
 *
 *   - case is ignored, so "yes 4821" and "YES 4821" both work
 *   - the reference can be attached or spaced: "YES4821" and "YES 4821"
 *   - extra words are ignored, so "yes 4821 ok" still accepts
 *   - "Y" and "N" are accepted as shorthand
 *
 * What it deliberately does NOT do is guess. If the keyword is unrecognisable the
 * intent is UNKNOWN and the system replies with the valid options, rather than
 * risking a wrong record from a misread message.
 */
export function parseReply(raw: string): ParsedReply {
  const text = raw.trim().toUpperCase();

  const refMatch = text.match(/(\d{4})/);
  const ref = refMatch?.[1];

  // WRONG is checked before NO, because "WRONG" does not begin with NO but a
  // careless pattern order could still let a broader rule swallow it.
  if (/^(WRONG|GALAT|BHUL|W)\b/.test(text) || /^WRONG\d/.test(text)) {
    return { intent: "REJECT", ref };
  }
  // OK confirms a work or payment record. Kept separate from YES, which accepts
  // an offer, so a worker cannot accidentally accept a job by confirming a day.
  if (/^(OK|OKAY|THIK|SAHI|SARI)\b/.test(text) || /^OK\d/.test(text)) {
    return { intent: "CONFIRM", ref };
  }
  if (/^(YES|Y|HAAN|HA|ACCEPT)\b/.test(text) || /^YES\d/.test(text)) {
    return { intent: "ACCEPT", ref };
  }
  if (/^(NO|N|NAHI|NA|REFUSE|DECLINE)\b/.test(text) || /^NO\d/.test(text)) {
    return { intent: "DECLINE", ref };
  }
  if (/^(BAL|BALANCE|PAISA|TAKA)\b/.test(text)) {
    return { intent: "BALANCE", ref };
  }

  return { intent: "UNKNOWN", ref };
}

/** The reply sent when a message could not be understood. */
export function helpMessage(language: Language): string {
  switch (language) {
    case "hi":
      return `Samajh nahi aaya. Kaam lene ke liye: YES <code>. Mana: NO <code>. Record sahi hai: OK <code>. Galat hai: WRONG <code>. Baki: BAL`;
    case "bn":
      return `Bujhte parlam na. Kaj nite: YES <code>. Na: NO <code>. Record thik: OK <code>. Bhul: WRONG <code>. Baki: BAL`;
    case "or":
      return `Bujhi parili nahin. Kama nebaku: YES <code>. Manaa: NO <code>. Record thik: OK <code>. Bhula: WRONG <code>. Baki: BAL`;
    case "ml":
      return `Manassilayilla. Joli sweekarikkan: YES <code>. Nirasikkan: NO <code>. Record sheri: OK <code>. Thettu: WRONG <code>. Baaki: BAL`;
    default:
      return `Not understood. Accept work: YES <code>. Refuse: NO <code>. Record is correct: OK <code>. Record is wrong: WRONG <code>. Balance: BAL`;
  }
}

// ---------------------------------------------------------------------------
// Confirmation messages
//
// These are what close the hole in the work log. The contractor writes the
// record; the worker is asked, the same day, whether it is true. A record
// nobody confirmed is not evidence, and the system says so rather than
// pretending otherwise.
//
// The keywords are OK and WRONG, in Latin capitals, because they must be
// typeable on any handset regardless of the message's own script - and because
// they are short enough that a worker who cannot read the rest of the message
// can still be taught the two replies.
// ---------------------------------------------------------------------------

/** Ask the worker to confirm a stretch of work the contractor recorded. */
export function confirmWorkMessage(
  input: { days: number; fromDate: string; toDate: string; contractorName: string; ref: string },
  language: Language,
): string {
  const { days, fromDate, toDate, contractorName, ref } = input;
  const period = `${fromDate} - ${toDate}`;

  switch (language) {
    case "hi":
      return [
        `${contractorName} ne likha:`,
        `${period}`,
        `${days} din kaam`,
        ``,
        `Sahi hai to: OK ${ref}`,
        `Galat hai to: WRONG ${ref}`,
      ].join("\n");
    case "bn":
      return [
        `${contractorName} likhechen:`,
        `${period}`,
        `${days} din kaj`,
        ``,
        `Thik thakle: OK ${ref}`,
        `Bhul thakle: WRONG ${ref}`,
      ].join("\n");
    case "or":
      return [
        `${contractorName} lekhichanti:`,
        `${period}`,
        `${days} dina kama`,
        ``,
        `Thik thile: OK ${ref}`,
        `Bhula thile: WRONG ${ref}`,
      ].join("\n");
    case "ml":
      return [
        `${contractorName} rekhappeduthi:`,
        `${period}`,
        `${days} divasam joli`,
        ``,
        `Sheriyanenkil: OK ${ref}`,
        `Thettanenkil: WRONG ${ref}`,
      ].join("\n");
    default:
      return [
        `${contractorName} recorded:`,
        `${period}`,
        `${days} days worked`,
        ``,
        `If correct, reply: OK ${ref}`,
        `If wrong, reply: WRONG ${ref}`,
      ].join("\n");
  }
}

/**
 * Ask the worker to confirm a payment.
 *
 * More important than it looks: a cash payment leaves no bank trail, so "I paid
 * him Rs 8000" is otherwise only a claim. The worker's OK is the receipt.
 */
export function confirmPaymentMessage(
  input: { amount: number; paidOn: string; contractorName: string; ref: string },
  language: Language,
): string {
  const amt = Math.round(input.amount);
  const { paidOn, contractorName, ref } = input;

  switch (language) {
    case "hi":
      return [
        `${contractorName} ne likha:`,
        `Rs ${amt} diya, ${paidOn}`,
        ``,
        `Mila hai to: OK ${ref}`,
        `Nahi mila to: WRONG ${ref}`,
      ].join("\n");
    case "bn":
      return [
        `${contractorName} likhechen:`,
        `Rs ${amt} diyechen, ${paidOn}`,
        ``,
        `Peyechen to: OK ${ref}`,
        `Na pele: WRONG ${ref}`,
      ].join("\n");
    case "or":
      return [
        `${contractorName} lekhichanti:`,
        `Rs ${amt} dele, ${paidOn}`,
        ``,
        `Paichanti to: OK ${ref}`,
        `Nahin paile: WRONG ${ref}`,
      ].join("\n");
    case "ml":
      return [
        `${contractorName} rekhappeduthi:`,
        `Rs ${amt} nalki, ${paidOn}`,
        ``,
        `Kittiyenkil: OK ${ref}`,
        `Kittiyillenkil: WRONG ${ref}`,
      ].join("\n");
    default:
      return [
        `${contractorName} recorded:`,
        `Paid you Rs ${amt} on ${paidOn}`,
        ``,
        `If you received it, reply: OK ${ref}`,
        `If not, reply: WRONG ${ref}`,
      ].join("\n");
  }
}

/** Receipt after the worker confirms. Their copy of the agreed figure. */
export function confirmedReceipt(
  input: { what: string; ref: string },
  language: Language,
): string {
  switch (language) {
    case "hi":
      return `Dhanyawad. ${input.what} - aapne sahi bataya. Yeh record ab dono ne maana hai. Ref ${input.ref}`;
    case "bn":
      return `Dhonnobad. ${input.what} - apni thik bolechen. Ei record ekhon dujonei mene niyeche. Ref ${input.ref}`;
    case "or":
      return `Dhanyabad. ${input.what} - apana thik kahichanti. Ehi record ebe dui pakhya manichanti. Ref ${input.ref}`;
    case "ml":
      return `Nandi. ${input.what} - ningal sherikkum sthireekarichu. Ee record ippol randu perum sammadhichathaanu. Ref ${input.ref}`;
    default:
      return `Thank you. ${input.what} - you confirmed this is correct. This record is now agreed by both sides. Ref ${input.ref}`;
  }
}

/** Receipt after the worker rejects a record. */
export function disputedReceipt(
  input: { what: string; ref: string },
  language: Language,
): string {
  switch (language) {
    case "hi":
      return `${input.what} - aapne galat bataya. Yeh shram adhikari ko bheja gaya hai. Ref ${input.ref}`;
    case "bn":
      return `${input.what} - apni bhul bolechen. Eta shrom adhikarik ke pathano hoyeche. Ref ${input.ref}`;
    case "or":
      return `${input.what} - apana bhula kahichanti. Eha shrama adhikari nikatare pathaa gala. Ref ${input.ref}`;
    case "ml":
      return `${input.what} - ningal ithu thettanenu ariyichu. Ithu thozhil offeesarku ayachu. Ref ${input.ref}`;
    default:
      return `${input.what} - you reported this as wrong. It has been sent to the labour officer. Ref ${input.ref}`;
  }
}

// ---------------------------------------------------------------------------
// Handover code messages
// ---------------------------------------------------------------------------

/**
 * The code message, sent to the worker's phone when the contractor is about to
 * hand over cash.
 *
 * The wording carries the one instruction that makes the code mean anything:
 * do not give it out until the money is actually in your hand. A code given
 * before payment proves nothing, so the message says so every time rather than
 * relying on the worker having been trained once.
 */
export function handoverCodeMessage(
  input: { amount: number; contractorName: string; code: string },
  language: Language,
): string {
  const amt = Math.round(input.amount);
  const { contractorName, code } = input;

  switch (language) {
    case "hi":
      return [
        `Code: ${code}`,
        `${contractorName} se Rs ${amt} nagad ke liye.`,
        ``,
        `Paisa haath me aane ke BAAD hi yeh code batayein.`,
        `Paisa nahi mila to code na batayein.`,
      ].join("\n");
    case "bn":
      return [
        `Code: ${code}`,
        `${contractorName} theke Rs ${amt} nagad er jonno.`,
        ``,
        `Taka haate pawar PORE i ei code din.`,
        `Taka na pele code deben na.`,
      ].join("\n");
    case "or":
      return [
        `Code: ${code}`,
        `${contractorName} tharu Rs ${amt} nagada pain.`,
        ``,
        `Paisa hatare paiba PARE hin ehi code dianttu.`,
        `Paisa na paile code dianttu nahin.`,
      ].join("\n");
    case "ml":
      return [
        `Code: ${code}`,
        `${contractorName}-il ninnu Rs ${amt} panam.`,
        ``,
        `Panam kayyil kittiya SHESHAM mathram ee code kodukkuka.`,
        `Kittiyillenkil code kodukkaruthu.`,
      ].join("\n");
    default:
      return [
        `Code: ${code}`,
        `For Rs ${amt} cash from ${contractorName}.`,
        ``,
        `Give this code ONLY after the money is in your hand.`,
        `If you have not been paid, do not give the code.`,
      ].join("\n");
  }
}

/** Receipt after a code-confirmed handover. The worker's own copy. */
export function handoverDoneMessage(
  input: { amount: number; contractorName: string; ref: string },
  language: Language,
): string {
  const amt = Math.round(input.amount);

  switch (language) {
    case "hi":
      return `Rs ${amt} nagad, ${input.contractorName} se, code se darj hua. Yeh aapki rasid hai. Ref ${input.ref}`;
    case "bn":
      return `Rs ${amt} nagad, ${input.contractorName} theke, code diye record holo. Eta apnar rosid. Ref ${input.ref}`;
    case "or":
      return `Rs ${amt} nagada, ${input.contractorName} tharu, code dwara record hela. Eha apananka rasida. Ref ${input.ref}`;
    case "ml":
      return `Rs ${amt} panam, ${input.contractorName}-il ninnu, code upayogichu rekhappeduthi. Ithu ningalude receipt aanu. Ref ${input.ref}`;
    default:
      return `Rs ${amt} cash from ${input.contractorName}, recorded with your code. This is your receipt. Ref ${input.ref}`;
  }
}

/**
 * Generate a 4-digit handover code.
 *
 * Four digits because it has to be read aloud from one phone and typed into
 * another, often in a noisy place. The short length is acceptable because the
 * code lives for minutes, works once, and is tied to one amount - guessing it
 * would require the contractor to also guess when a code exists at all.
 */
export function generateHandoverCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}
