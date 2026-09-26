import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { normalisePhone, requireAuth, signToken, type Role } from "../lib/auth";
import { HOME_STATES, STATE_LANGUAGE, phoneCodeMessage, sendCodeSms, type Language } from "../lib/sms";
import { CODE_MINUTES, createCode, useCode, type CodePurpose } from "../lib/phoneCodes";

export const authRouter = Router();

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
const LOCKED_MESSAGE = `Too many wrong PINs. Wait ${LOCK_MINUTES} minutes and try again.`;

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
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }

  const phone = normalisePhone(parsed.data.phone);
  const user = await prisma.user.findUnique({ where: { phone } });

  // A locked number is refused before the PIN is even compared, so guessing
  // during the lock learns nothing, not even whether a guess was right.
  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    return res.status(429).json({ error: LOCKED_MESSAGE });
  }

  // Same message whether the number is unknown or the PIN is wrong, so the
  // response does not reveal which numbers are registered.
  // An account with no PIN yet (made by the labour office, ADR-0014) cannot
  // sign in. It answers like a wrong PIN, and it is not counted towards the
  // lock, because no PIN exists that could be guessed.
  if (user && user.pin === null) {
    return res.status(401).json({ error: "Wrong phone number or PIN" });
  }

  const ok = user?.pin ? await bcrypt.compare(parsed.data.pin, user.pin) : false;
  if (!user) {
    return res.status(401).json({ error: "Wrong phone number or PIN" });
  }

  if (!ok) {
    // Counted with an atomic increment, so two wrong guesses sent at the same
    // moment cannot both read the old count and each add one to it.
    const after = await prisma.user.update({
      where: { id: user.id },
      data: { failedPinCount: { increment: 1 } },
      select: { failedPinCount: true },
    });
    if (after.failedPinCount >= MAX_WRONG_PINS) {
      await prisma.user.update({
        where: { id: user.id },
        data: { lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000), failedPinCount: 0 },
      });
    }
    return res.status(401).json({ error: "Wrong phone number or PIN" });
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
 * Send a one-time 6-digit code by SMS (ADR-0014).
 *
 * The answer is the same whether or not the number has an account, so this
 * route cannot be used to find out who is registered. The SMS itself goes out
 * only when it is useful: a REGISTER code only to a new number, a RESET_PIN
 * code only to a number that has an account.
 *
 * The limits (1 a minute, 5 a day) are checked first, and for every number,
 * so a refused request looks the same for registered and unregistered numbers.
 */
authRouter.post("/code", async (req, res) => {
  const parsed = codeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }
  const phone = normalisePhone(parsed.data.phone);
  if (phone.length !== 10) {
    return res.status(400).json({ error: "Enter a 10-digit mobile number" });
  }
  const purpose: CodePurpose = parsed.data.purpose;

  const user = await prisma.user.findUnique({ where: { phone }, select: { language: true } });
  const shouldSend = purpose === "REGISTER" ? user === null : user !== null;

  if (shouldSend) {
    const made = await createCode(phone, purpose);
    if (!made.ok) return res.status(made.status).json({ error: made.error });

    // The account's own language for a reset; the chosen one for a new worker.
    const language = (user?.language ?? parsed.data.language ?? "en") as Language;
    await sendCodeSms(phone, phoneCodeMessage(made.code, language));
  }

  return res.json({ sent: true, expiresInMinutes: CODE_MINUTES });
});

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
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }

  const { name, pin, homeState, code } = parsed.data;
  const phone = normalisePhone(parsed.data.phone);
  if (phone.length !== 10) {
    return res.status(400).json({ error: "Enter a 10-digit mobile number" });
  }

  const existing = await prisma.user.findUnique({ where: { phone } });
  if (existing) {
    return res.status(409).json({
      error: "That number is already registered. Sign in with your PIN instead.",
    });
  }

  if (!(await useCode(phone, "REGISTER", code))) {
    return res.status(400).json({ error: "That code is wrong or has expired. Ask for a new code." });
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
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }
  const phone = normalisePhone(parsed.data.phone);

  // The code is checked before the account is looked up, so an unknown number
  // and a wrong code give the same answer.
  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user || !(await useCode(phone, "RESET_PIN", parsed.data.code))) {
    return res.status(400).json({ error: "That code is wrong or has expired. Ask for a new code." });
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
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }
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
