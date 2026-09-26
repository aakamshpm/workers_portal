import type { Role } from "./types";

/**
 * Where each role's app lives. ADR-0012.
 *
 * The one place these addresses are written, so the sign-in page, every app's
 * guard, and the Vite build cannot disagree about them.
 */
const APP_FOR_ROLE: Record<Role, string> = {
  WORKER: "/worker/",
  CONTRACTOR: "/contractor/",
  AUTHORITY: "/officer/",
};

export function appFor(role: Role): string {
  return APP_FOR_ROLE[role];
}

/** The sign-in page, where every signed-out visitor is sent. */
export const SIGN_IN = "/";
