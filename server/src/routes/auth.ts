import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { normalisePhone, signToken, type Role } from "../lib/auth";
import { HOME_STATES, STATE_LANGUAGE, type Language } from "../lib/sms";

export const authRouter = Router();

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

  // Same message whether the number is unknown or the PIN is wrong, so the
  // response does not reveal which numbers are registered.
  const ok = user ? await bcrypt.compare(parsed.data.pin, user.pin) : false;
  if (!user || !ok) {
    return res.status(401).json({ error: "Wrong phone number or PIN" });
  }

  const payload = {
    id: user.id,
    name: user.name,
    phone: user.phone,
    role: user.role as Role,
    language: user.language,
    homeState: user.homeState,
    company: user.company,
  };

  return res.json({ token: signToken(payload), user: payload });
});

const registerSchema = z.object({
  name: z.string().min(2, "Enter your name").max(80),
  phone: z.string().min(6, "Enter your phone number"),
  pin: z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits"),
  homeState: z.string().optional(),
  language: z.enum(["en", "hi", "bn", "ml", "or"]).optional(),
});

/**
 * POST /api/auth/register
 *
 * Worker self-registration.
 *
 * Only workers can sign themselves up. Contractor and authority accounts are
 * created by the labour department, because a contractor account can write records
 * that bind a worker - anyone being able to create one would defeat the point.
 *
 * The language defaults from the home state, so a worker from West Bengal gets
 * Bengali messages without having to understand a language menu.
 */
authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }

  const { name, pin, homeState } = parsed.data;
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

  const language: Language =
    parsed.data.language ?? (homeState ? STATE_LANGUAGE[homeState] ?? "en" : "en");

  const user = await prisma.user.create({
    data: {
      name: name.trim(),
      phone,
      pin: await bcrypt.hash(pin, 10),
      role: "WORKER",
      homeState: homeState ?? null,
      language,
      selfRegistered: true,
    },
  });

  const payload = {
    id: user.id,
    name: user.name,
    phone: user.phone,
    role: user.role as Role,
    language: user.language,
    homeState: user.homeState,
    company: user.company,
  };

  return res.status(201).json({ token: signToken(payload), user: payload });
});

/** The home states offered at registration, with the language each implies. */
authRouter.get("/states", (_req, res) => {
  res.json(HOME_STATES.map((s) => ({ state: s, language: STATE_LANGUAGE[s] })));
});

/**
 * GET /api/auth/demo-accounts
 *
 * Lists every account so the login screen can help find one during a
 * presentation. Remove this route for real use.
 *
 * PINs are never returned, for anyone. For the seven seeded accounts that PIN is
 * always 1234, printed by the seed script, so the login screen can click straight
 * in. A worker who registered himself chose his own PIN, which this route cannot
 * know, so those accounts are listed to save the trouble of remembering a phone
 * number, but still need the PIN typed - `selfRegistered` is returned so the
 * client can tell the two groups apart and only offer one-click sign-in for the
 * ones where it is actually one click.
 */
authRouter.get("/demo-accounts", async (_req, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      phone: true,
      role: true,
      homeState: true,
      language: true,
      company: true,
      selfRegistered: true,
    },
    orderBy: [{ selfRegistered: "asc" }, { role: "asc" }, { name: "asc" }],
  });
  return res.json(users);
});
