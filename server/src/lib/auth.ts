import "dotenv/config";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

export type Role = "CONTRACTOR" | "WORKER" | "AUTHORITY";

export const ROLES: Role[] = ["CONTRACTOR", "WORKER", "AUTHORITY"];

export interface AuthUser {
  id: string;
  name: string;
  phone: string;
  role: Role;
  language?: string;
  homeState?: string | null;
  company?: string | null;
}

/** Express does not know about our custom property, so we declare it. */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * The key that signs every session. ADR-0013.
 *
 * There is no fallback. A default written in the code would let anyone who has
 * read the code sign a session for any user, so a missing key stops the
 * server at startup instead, as HMAC_SECRET does (ADR-0004).
 */
export function getJwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) {
    throw new Error("JWT_SECRET is not set. Set it in server/.env");
  }
  return s;
}

const TOKEN_TTL = "8h";

export function signToken(user: AuthUser): string {
  return jwt.sign(user, getJwtSecret(), { expiresIn: TOKEN_TTL });
}

/**
 * Rejects the request unless it carries a valid bearer token. On success the
 * decoded user is attached to `req.user`.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Not signed in" });
  }

  const token = header.slice("Bearer ".length);
  try {
    const payload = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload & AuthUser;
    req.user = {
      id: payload.id,
      name: payload.name,
      phone: payload.phone,
      role: payload.role,
      language: payload.language,
      homeState: payload.homeState,
      company: payload.company,
    };
    return next();
  } catch {
    return res.status(401).json({ error: "Your session has expired. Please sign in again." });
  }
}

/**
 * Role gate. Use after `requireAuth`.
 *
 * Authorisation is checked on the server for every action that writes. The
 * frontend hiding a button is a convenience, never the control.
 */
export function requireRole(...allowed: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Not signed in" });
    }
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({
        error: `Only a ${allowed.join(" or ").toLowerCase()} can do that`,
      });
    }
    return next();
  };
}

/**
 * Normalise an Indian phone number to a comparable form.
 *
 * A worker will type their number differently every time: with the country code,
 * with spaces, with a leading zero. Since the phone number IS the account
 * identifier, all of those must reach the same account, otherwise a worker gets
 * locked out of their own record.
 *
 * Keeps the last 10 digits, which is the part that identifies an Indian mobile.
 */
export function normalisePhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** Display form: +91 98800 30001 */
export function formatPhone(digits: string): string {
  if (digits.length !== 10) return digits;
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}
