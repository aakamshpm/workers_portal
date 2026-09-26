import { useState, type ReactNode } from "react";
import { NavLink, Navigate, Outlet } from "react-router-dom";
import { clearSession, getStoredUser } from "./api";
import { SIGN_IN, appFor } from "./apps";
import { leaveTo } from "./leave";
import type { AuthUser, Role } from "./types";
import { LanguagePicker, useT } from "./i18n";

const ROLE_LABEL: Record<Role, string> = {
  CONTRACTOR: "Contractor",
  WORKER: "Worker",
  AUTHORITY: "Labour Officer",
};

export interface Tab {
  /** Relative to the app, for example "work" inside /worker/. */
  path: string;
  label: string;
}

/**
 * The signed-in session for one app. ADR-0012.
 *
 * An app opens only for its own role. Anyone else is sent away once, before
 * anything renders:
 *   - nobody signed in: to the sign-in page at "/";
 *   - another role: to that role's own app.
 *
 * This hides screens that do not belong to the reader. It is not the security
 * control: the server's requireRole checks are, and they apply to every
 * request whichever app sent it.
 */
export function useAppSession(role: Role): AuthUser | null {
  // Read once. Each app is a separate page load, so a sign-in elsewhere reaches
  // this app only by loading it again.
  const [user] = useState<AuthUser | null>(() => getStoredUser());
  const allowed = user !== null && user.role === role;

  // Leaving during render is safe here: it is a full page load that replaces
  // this app, and returning null below renders nothing in the meantime.
  if (!allowed) leaveTo(user ? appFor(user.role) : SIGN_IN);
  return allowed ? user : null;
}

/**
 * The header, the tabs and the frame around every signed-in page of one app.
 *
 * `children` is the app's routes. A route with no match falls back to the
 * app's first tab, so a mistyped address stays inside the app.
 */
export function AppShell({ user, tabs, children }: { user: AuthUser; tabs: Tab[]; children?: ReactNode }) {
  // English unless the app mounts an I18nProvider. Only the worker app does (ADR-0015).
  const { t } = useT();
  const roleLabel = user.role === "WORKER" ? t("roleWorker") : ROLE_LABEL[user.role];

  function signOut() {
    clearSession();
    leaveTo(SIGN_IN);
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-3.5">
          <div>
            <h1 className="text-sm font-semibold tracking-tight text-slate-900">{t("appTitle")}</h1>
            <p className="text-xs text-slate-500">{t("appTagline")}</p>
          </div>

          <div className="flex items-center gap-4">
            <LanguagePicker />
            <div className="text-right">
              <p className="text-sm font-medium text-slate-900">{user.name}</p>
              <p className="text-xs text-slate-500">
                {roleLabel}
                {user.homeState ? ` · ${user.homeState}` : ""}
                {user.company ? ` · ${user.company}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={signOut}
              className="rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-300 transition hover:bg-slate-50"
            >
              {t("signOut")}
            </button>
          </div>
        </div>

        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-6" aria-label={t("sections")}>
          {tabs.map((t) => (
            <NavLink
              key={t.path}
              to={`/${t.path}`}
              className={({ isActive }) =>
                `-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition ${
                  isActive
                    ? "border-slate-900 text-slate-900"
                    : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
                }`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">{children ?? <Outlet />}</main>
    </div>
  );
}

/** Where a route that matches nothing in this app goes: the app's first tab. */
export function FirstTab({ tabs }: { tabs: Tab[] }) {
  return <Navigate to={`/${tabs[0]!.path}`} replace />;
}
