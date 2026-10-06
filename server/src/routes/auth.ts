import { Router, type Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { normalisePhone, requireAuth, signToken, type Role } from "../lib/auth";
import { HOME_STATES, STATE_LANGUAGE, phoneCodeMessage, sendCodeSms, type Language } from "../lib/sms";
import {
  CODE_MINUTES,
  confirmSent,
  createCode,
  discardCode,
  useCode,
  type CodePurpose,
} from "../lib/phoneCodes";

export const authRouter = Router();

/**
 * Every refusal from these routes carries a fixed code next to the English
 * message (ADR-0020). The sign-in page shows its own text for the code, in the
 * reader's language; the English is for logs and for the staff apps.
 * The list is in docs/contracts/auth.md.
 */
type AuthError =
  | "INVALID_INPUT"
  | "INVALID_PHONE"
  | "PHONE_REGISTERED"
  | "PHONE_NOT_REGISTERED"
  | "CODE_WAIT"
  | "CODE_DAILY_LIMIT"
  | "SMS_FAILED"
  | "CODE_WRONG"
  | "WRONG_PIN"
  | "PIN_LOCKED";

function refuse(
  res: Response,
  status: number,
  code: AuthError,
  error: string,
  extra: Record<string, unknown> = {},
) {
  return res.status(status).json({ error, code, ...extra });
}

/**
 * The first problem zod found, as the English message. A problem with the
 * phone field is INVALID_PHONE, the same code the 10-digit check gives, so a
 * short number gets one answer whichever check caught it.
 */
function invalid(res: Response, issues: { message: string; path: PropertyKey[] }[]) {
  const first = issues[0];
  if (first?.path[0] === "phone") {
    return refuse(res, 400, "INVALID_PHONE", "Enter a 10-digit mobile number");
  }
  return refuse(res, 400, "INVALID_INPUT", first?.message ?? "Invalid input");
}

/**
 * Wrong-PIN lock (ADR-0013).
 *
 * A four-digit PIN has 10,000 values. Without a limit, a script can try all of
 * them in minutes. Five wrong in a row locks the number for 15 minutes, which
 * makes trying every PIN take weeks, while a worker who mistypes a few times
 * is not locked out.
 */
const MAX_WRONG_PINS = 5;
const LOCK_MINUTES = 15;
const WRONG_PIN = "Wrong phone number or PIN";

/** Minutes left on a lock, rounded up, so "0 minutes" is never shown. */
function minutesLeft(until: Date): number {
  return Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
}

function locked(res: Response, until: Date) {
  const minutes = minutesLeft(until);
  return refuse(res, 429, "PIN_LOCKED", `Too many wrong PINs. Wait ${minutes} minutes and try again.`, {
    minutesLeft: minutes,
  });
}

const loginSchema = z.object({
  phone: z.string().min(6, "Enter your phone number"),
  pin: z.string().min(4, "Enter your 4-digit PIN"),
});

/**
 * POST /api/auth/login
 *
 * Phone number and a 4-digit PIN, not email and password.
 *
 * A migrant worker has a phone number; many have no email address, and asking for
 * one would exclude the people the system is for. A 4-digit PIN can be typed on a
 * basic keypad and read out over a helpline call.
 */
authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error.issues);

  const phone = normalisePhone(parsed.data.phone);
  const user = await prisma.user.findUnique({ where: { phone } });

  // A locked number is refused before the PIN is even compared, so guessing
  // during the lock learns nothing, not even whether a guess was right.
  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    return locked(res, user.lockedUntil);
  }

  // A number with no account is told so (ADR-0022). "Wrong phone number or
  // PIN" hid nothing after ADR-0020, because the code route already says
  // whether a number has an account, and it sent a worker who had mistyped one
  // digit of his number to try other PINs.
  if (!user) {
    return refuse(res, 404, "PHONE_NOT_REGISTERED", "That number has no account. A new worker can make one.");
  }

  // An account with no PIN yet (made by the labour office, ADR-0014) cannot
  // sign in. It answers like a wrong PIN, and it is not counted towards the
  // lock, because no PIN exists that could be guessed.
  if (user.pin === null) {
    return refuse(res, 401, "WRONG_PIN", WRONG_PIN);
  }

  const ok = await bcrypt.compare(parsed.data.pin, user.pin);

  if (!ok) {
    // Counted with an atomic increment, so two wrong guesses sent at the same
    // moment cannot both read the old count and each add one to it.
    const after = await prisma.user.update({
      where: { id: user.id },
      data: { failedPinCount: { increment: 1 } },
      select: { failedPinCount: true },
    });
    if (after.failedPinCount >= MAX_WRONG_PINS) {
      const until = new Date(Date.now() + LOCK_MINUTES * 60_000);
      await prisma.user.update({
        where: { id: user.id },
        data: { lockedUntil: until, failedPinCount: 0 },
      });
      // Said now, on the fifth, so the worker does not type a sixth PIN and
      // only then learn that the number was already locked.
      return locked(res, until);
    }
    return refuse(res, 401, "WRONG_PIN", WRONG_PIN);
  }

  if (user.failedPinCount > 0 || user.lockedUntil) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedPinCount: 0, lockedUntil: null },
    });
  }

  return res.json(sessionFor(user));
});

/** The session a signed-in user gets, from any route that signs someone in. */
function sessionFor(user: {
  id: string;
  name: string;
  phone: string;
  role: string;
  language: string;
  homeState: string | null;
  company: string | null;
}) {
  const payload = {
    id: user.id,
    name: user.name,
    phone: user.phone,
    role: user.role as Role,
    language: user.language,
    homeState: user.homeState,
    company: user.company,
  };
  return { token: signToken(payload), user: payload };
}

const LANGUAGES = ["en", "hi", "bn", "ml", "or"] as const;

const codeSchema = z.object({
  phone: z.string().min(6, "Enter your phone number"),
  purpose: z.enum(["REGISTER", "RESET_PIN"]),
  language: z.enum(LANGUAGES).optional(),
});

/**
 * POST /api/auth/code
 *
 * Send a one-time 6-digit code by SMS (ADR-0014, ADR-0020).
 *
 * The route says what happened, because a worker told "a code is coming" when
 * none is waits for an SMS that never arrives:
 *   - a registration code for a number that already has an account, and a
 *     reset code for a number with none, are refused, and nothing is sent;
 *   - `sent: true` means the SMS was handed to the gateway;
 *   - a failed send removes the new code, so the worker keeps the code he
 *     already has and his limits are not used up.
 *
 * This tells anyone whether a number has an account. ADR-0020 records why that
 * is accepted.
 */
authRouter.post("/code", async (req, res) => {
  const parsed = codeSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error.issues);
  const phone = normalisePhone(parsed.data.phone);
  if (phone.length !== 10) {
    return refuse(res, 400, "INVALID_PHONE", "Enter a 10-digit mobile number");
  }
  const purpose: CodePurpose = parsed.data.purpose;

  const user = await prisma.user.findUnique({ where: { phone }, select: { language: true } });
  if (purpose === "REGISTER" && user) {
    return refuse(res, 409, "PHONE_REGISTERED", "That number already has an account. Sign in, or use Forgot PIN.");
  }
  if (purpose === "RESET_PIN" && !user) {
    return refuse(res, 404, "PHONE_NOT_REGISTERED", "That number has no account. A new worker can make one.");
  }

  const made = await createCode(phone, purpose);
  if (!made.ok) return refuse(res, made.status, made.code, made.error);

  // The account's own language for a reset; the chosen one for a new worker.
  const language = (user?.language ?? parsed.data.language ?? "en") as Language;
  try {
    await sendCodeSms(phone, phoneCodeMessage(made.code, language));
  } catch (err) {
    await discardCode(made.id);
    console.error("code SMS failed:", err instanceof Error ? err.message : err);
    return refuse(res, 502, "SMS_FAILED", "The SMS could not be sent. Please try again.");
  }
  await confirmSent(phone, purpose, made.id);

  return res.json({ sent: true, expiresInMinutes: CODE_MINUTES });
});

const CODE_WRONG = "That code is wrong or has expired. Ask for a new code.";

const registerSchema = z.object({
  phone: z.string().min(6, "Enter your phone number"),
  code: z.string().regex(/^\d{6}$/, "The code is 6 digits"),
  name: z.string().trim().min(2, "Enter your name").max(80),
  pin: z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits"),
  homeState: z.string().optional(),
  language: z.enum(LANGUAGES).optional(),
});

/**
 * POST /api/auth/register
 *
 * A worker creates his own account, with the code sent to that phone.
 *
 * Only workers register themselves. Contractor and officer accounts are made
 * by the labour office (ADR-0014), because a contractor account can write
 * records that bind a worker.
 *
 * The language defaults from the home state, so a worker from West Bengal
 * gets Bengali messages without having to understand a language menu.
 */
authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error.issues);

  const { name, pin, homeState, code } = parsed.data;
  const phone = normalisePhone(parsed.data.phone);
  if (phone.length !== 10) {
    return refuse(res, 400, "INVALID_PHONE", "Enter a 10-digit mobile number");
  }

  const existing = await prisma.user.findUnique({ where: { phone } });
  if (existing) {
    return refuse(res, 409, "PHONE_REGISTERED", "That number already has an account. Sign in, or use Forgot PIN.");
  }

  if (!(await useCode(phone, "REGISTER", code))) {
    return refuse(res, 400, "CODE_WRONG", CODE_WRONG);
  }

  const language: Language =
    parsed.data.language ?? (homeState ? STATE_LANGUAGE[homeState] ?? "en" : "en");

  const user = await prisma.user.create({
    data: {
      name,
      phone,
      pin: await bcrypt.hash(pin, 10),
      role: "WORKER",
      homeState: homeState ?? null,
      language,
      selfRegistered: true,
    },
  });

  return res.status(201).json(sessionFor(user));
});

const resetSchema = z.object({
  phone: z.string().min(6, "Enter your phone number"),
  code: z.string().regex(/^\d{6}$/, "The code is 6 digits"),
  pin: z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits"),
});

/**
 * POST /api/auth/reset-pin
 *
 * Set a new PIN with the code sent to the account's own phone (ADR-0014).
 * This is also how someone the labour office made an account for sets his
 * first PIN, so nobody but him ever knows it. The wrong-PIN lock is cleared.
 */
authRouter.post("/reset-pin", async (req, res) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error.issues);
  const phone = normalisePhone(parsed.data.phone);

  // The code is checked before the account is looked up, so an unknown number
  // and a wrong code give the same answer.
  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user || !(await useCode(phone, "RESET_PIN", parsed.data.code))) {
    return refuse(res, 400, "CODE_WRONG", CODE_WRONG);
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { pin: await bcrypt.hash(parsed.data.pin, 10), failedPinCount: 0, lockedUntil: null },
  });

  return res.json(sessionFor(updated));
});

const languageSchema = z.object({ language: z.enum(LANGUAGES, { error: "Choose one of the languages" }) });

/**
 * PATCH /api/auth/language. ADR-0015.
 *
 * The signed-in user changes his own language: the worker app's text and every
 * later SMS. Only his own row is changed, because the id comes from the token,
 * never from the request body.
 *
 * The answer has a new token, because the app keeps the user from the token,
 * and the old one still carries the old language.
 */
authRouter.patch("/language", requireAuth, async (req, res) => {
  const parsed = languageSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error.issues);
  const updated = await prisma.user.update({
    where: { id: req.user!.id },
    data: { language: parsed.data.language },
  });
  return res.json(sessionFor(updated));
});

/** The home states offered at registration, with the language each implies. */
authRouter.get("/states", (_req, res) => {
  res.json(HOME_STATES.map((s) => ({ state: s, language: STATE_LANGUAGE[s] })));
});
