import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { normalisePhone, requireAuth, requireRole } from "../lib/auth";

/**
 * ===========================================================================
 * Accounts made by the labour office. ADR-0014, docs/contracts/auth.md.
 * ===========================================================================
 *
 * Workers register themselves. Contractors and officers cannot, because a
 * contractor account can write records that bind a worker, so a labour officer
 * creates them here.
 *
 * The officer never chooses the PIN. A new account has none and cannot sign
 * in until its owner sets one through "Forgot PIN", with a code sent to his
 * own phone. So nobody, not even the officer, knows another person's PIN.
 */

export const accountsRouter = Router();

accountsRouter.use(requireAuth, requireRole("AUTHORITY"));

/** The fields an officer sees. Never the PIN hash, never the lock counters. */
const accountSelect = {
  id: true,
  name: true,
  phone: true,
  role: true,
  company: true,
  pin: true,
  createdAt: true,
} as const;

function toAccount(u: {
  id: string;
  name: string;
  phone: string;
  role: string;
  company: string | null;
  pin: string | null;
  createdAt: Date;
}) {
  const { pin, ...rest } = u;
  return { ...rest, hasPin: pin !== null };
}

/** GET /api/accounts: contractor and officer accounts, newest first. */
accountsRouter.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({
    where: { role: { in: ["CONTRACTOR", "AUTHORITY"] } },
    orderBy: { createdAt: "desc" },
    select: accountSelect,
  });
  return res.json({ accounts: users.map(toAccount) });
});

const createSchema = z
  .object({
    role: z.enum(["CONTRACTOR", "AUTHORITY"], { error: "Choose contractor or labour officer" }),
    name: z.string().trim().min(2, "Enter the name").max(80),
    phone: z.string().min(6, "Enter the phone number"),
    company: z.string().trim().max(120).optional(),
  })
  .refine((a) => a.role !== "CONTRACTOR" || (a.company?.length ?? 0) >= 2, {
    message: "Enter the contractor's company",
    path: ["company"],
  })
  .refine((a) => a.role !== "AUTHORITY" || !a.company, {
    message: "A labour officer has no company",
    path: ["company"],
  });

/** POST /api/accounts: create a contractor or officer account with no PIN. */
accountsRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }

  const phone = normalisePhone(parsed.data.phone);
  if (phone.length !== 10) {
    return res.status(400).json({ error: "Enter a 10-digit mobile number" });
  }
  if (await prisma.user.findUnique({ where: { phone }, select: { id: true } })) {
    return res.status(409).json({ error: "That number already has an account" });
  }

  const user = await prisma.user.create({
    data: {
      role: parsed.data.role,
      name: parsed.data.name,
      phone,
      company: parsed.data.role === "CONTRACTOR" ? parsed.data.company! : null,
      // Contractors and officers here are in Kerala, and read Malayalam or English.
      homeState: "Kerala",
      language: "ml",
      pin: null,
    },
    select: accountSelect,
  });

  return res.status(201).json(toAccount(user));
});
