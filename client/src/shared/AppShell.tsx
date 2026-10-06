import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { NavLink, Navigate, Outlet } from "react-router-dom";
import { clearSession, getStoredUser } from "./api";
import { SIGN_IN, appFor } from "./apps";
import { leaveTo } from "./leave";
import type { AuthUser, Role } from "./types";
import { LanguagePicker, stateName, useT } from "./i18n";
import { install, useCanInstall } from "./install";
import AppHeader from "./components/AppHeader";
import Icon, { type IconName } from "./components/Icon";
import { Button, formatPhone } from "./components/ui";

const ROLE_LABEL: Record<Role, string> = {
  CONTRACTOR: "Contractor",
  WORKER: "Worker",
  AUTHORITY: "Labour Officer",
};

export interface Tab {
  /** Relative to the app, for example "work" inside /worker/. */
  path: string;
  label: string;
  /** Shown above the label in the worker app's bottom bar. */
  icon?: IconName;
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
  // The worker and contractor apps are used on a phone and share the design's
  // phone layout (W1). The officer's is a desktop website with a sidebar
  // (ADR-0021).
  if (user.role !== "AUTHORITY") return <PhoneFrame user={user} tabs={tabs}>{children}</PhoneFrame>;
  return <OfficerFrame user={user} tabs={tabs}>{children}</OfficerFrame>;
}

function signOut() {
  clearSession();
  leaveTo(SIGN_IN);
}

/**
 * The worker and contractor apps on a phone (design W1, ADR-0019).
 *
 * The header holds the app name, the language list (only where the app has
 * one: the worker app) and one button for his own account. Everything about him (name, phone, home state)
 * and "Sign out" sits behind that button, so the header fits a 320px phone in
 * every language, and "Sign out" is never next to a thumb by accident.
 *
 * The sections are a bar fixed at the foot of the screen, where a thumb
 * reaches. It comes after <main> in the page, so a screen reader reads the
 * screen first, and <main> keeps room under its last line for the bar.
 */
function PhoneFrame({ user, tabs, children }: { user: AuthUser; tabs: Tab[]; children?: ReactNode }) {
  const { t } = useT();
  const canInstall = useCanInstall();

  return (
    <div className="min-h-dvh bg-surface">
      <AppHeader title={t("appTitle")}>
        <LanguagePicker compact />
        <AccountButton user={user} />
      </AppHeader>

      <main className="mx-auto flex max-w-2xl flex-col gap-space-lg px-margin pt-space-lg pb-[calc(var(--size-bottom-nav)+var(--spacing-space-xl))]">
        {/* After the browser offers to install (ADR-0018). Here and not in the
            header, which has no room for a fourth control on a small phone. */}
        {canInstall && (
          <Button variant="secondary" icon="install_mobile" full onClick={() => void install()}>
            {t("installApp")}
          </Button>
        )}
        {children ?? <Outlet />}
      </main>

      <nav
        aria-label={t("sections")}
        className="fixed inset-x-0 bottom-0 z-10 bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_0_var(--color-outline-variant)] backdrop-blur"
      >
        <ul
          className="mx-auto grid min-h-[var(--size-bottom-nav)] max-w-2xl"
          // One equal column per section: four for the worker, three for the contractor.
          style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
        >
          {tabs.map((tab) => (
            <li key={tab.path} className="flex">
              <NavLink
                to={`/${tab.path}`}
                className={({ isActive }) =>
                  `flex min-h-[var(--size-bottom-nav)] w-full flex-col items-center justify-center gap-0.5 px-space-xs py-space-xs text-center font-label-sm text-label-sm leading-tight transition focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${
                    isActive ? "font-semibold text-primary" : "text-on-surface-variant hover:text-on-surface"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {tab.icon && (
                      // The active section gets a filled pill behind its icon,
                      // so it is marked by shape as well as by colour.
                      <span
                        className={`flex h-7 w-14 items-center justify-center rounded-full ${
                          isActive ? "bg-secondary-container" : ""
                        }`}
                      >
                        <Icon name={tab.icon} size={22} filled={isActive} />
                      </span>
                    )}
                    <span>{tab.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

/**
 * The reader's own account: one round button, and a small panel under it with
 * his name, phone, home state and "Sign out".
 *
 * The panel is a non-modal dialog. Escape or a tap outside closes it, and
 * focus goes back to the button, so a keyboard or screen reader user is not
 * left somewhere on the page with no idea where the panel went.
 */
function AccountButton({ user }: { user: AuthUser }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();

  function close() {
    setOpen(false);
    button.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    function outside(e: PointerEvent) {
      const target = e.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        aria-label={t("yourAccount")}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => (open ? close() : setOpen(true))}
        className="flex size-[var(--size-touch)] items-center justify-center rounded-full bg-primary text-on-primary transition hover:bg-primary-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <Icon name="person" size={24} />
      </button>

      {open && (
        <div
          ref={panel}
          id={panelId}
          role="dialog"
          aria-label={t("yourAccount")}
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
          }}
          className="absolute top-full right-0 z-20 mt-space-sm flex w-[min(18rem,calc(100vw-2*var(--spacing-margin)))] flex-col gap-space-md rounded-xl bg-surface-container-lowest p-space-lg shadow-lg ring-1 ring-outline-variant focus:outline-none"
        >
          <div className="flex flex-col gap-space-xs">
            <p className="font-headline-sm text-headline-sm break-words text-on-surface">{user.name}</p>
            <p className="font-label-md text-label-md text-on-surface-variant">
              {user.role === "WORKER" ? t("roleWorker") : ROLE_LABEL[user.role]}
              {user.homeState ? ` · ${stateName(t, user.homeState)}` : ""}
            </p>
            {user.company && <p className="font-label-md text-label-md text-on-surface-variant">{user.company}</p>}
            <p className="font-body-lg text-body-lg whitespace-nowrap text-on-surface">
              +91&nbsp;{formatPhone(user.phone)}
            </p>
          </div>
          <Button variant="secondary" icon="logout" full onClick={signOut}>
            {t("signOut")}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The labour officer's website (design O1 to O5, ADR-0021).
 *
 * A top bar with the app name, his name and office, and a visible "Sign out":
 * he uses a mouse and has the room, so his account is not hidden behind a
 * button as it is on a phone. The four sections are a sidebar at the left from
 * 1024px up, kept in view while the page scrolls. Below 1024px the same list
 * becomes a row under the top bar that scrolls inside itself.
 *
 * It is one <nav>, not one for each width, so a screen reader finds the
 * sections once. <main> may shrink (`min-w-0`), so a wide table inside it
 * scrolls inside its own box and never pushes the sidebar off the screen.
 *
 * The officer website is never installable (ADR-0012): no install button here.
 */
function OfficerFrame({ user, tabs, children }: { user: AuthUser; tabs: Tab[]; children?: ReactNode }) {
  // English: the officer website has no language list (ADR-0015).
  const { t } = useT();

  return (
    <div className="min-h-dvh bg-surface">
      <AppHeader title={t("appTitle")}>
        <div className="text-right">
          <p className="font-body-lg-medium text-body-lg-medium text-on-surface">{user.name}</p>
          <p className="font-label-md text-label-md text-on-surface-variant max-[639px]:hidden">
            {ROLE_LABEL[user.role]}
            {user.company ? ` · ${user.company}` : ""}
          </p>
        </div>
        <Button variant="secondary" size="dense" icon="logout" onClick={signOut}>
          {t("signOut")}
        </Button>
      </AppHeader>

      <div className="mx-auto flex max-w-7xl flex-col lg:flex-row">
        <nav
          aria-label={t("sections")}
          className="overflow-x-auto border-b border-outline-variant lg:sticky lg:top-[var(--size-header)] lg:w-64 lg:shrink-0 lg:self-start lg:overflow-visible lg:border-b-0 lg:p-space-md"
        >
          <ul className="flex gap-space-xs p-space-sm lg:flex-col lg:p-0">
            {tabs.map((tab) => (
              <li key={tab.path} className="shrink-0">
                <NavLink
                  to={`/${tab.path}`}
                  className={({ isActive }) =>
                    `flex min-h-[var(--size-touch)] items-center gap-space-sm rounded-xl px-space-md font-body-lg-medium text-body-lg-medium whitespace-nowrap transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                      isActive
                        ? "bg-primary-container text-on-primary"
                        : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {tab.icon && <Icon name={tab.icon} size={22} filled={isActive} />}
                      <span>{tab.label}</span>
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 flex-1 px-margin py-space-lg lg:px-margin-desktop">
          {children ?? <Outlet />}
        </main>
      </div>
    </div>
  );
}

/** Where a route that matches nothing in this app goes: the app's first tab. */
export function FirstTab({ tabs }: { tabs: Tab[] }) {
  return <Navigate to={`/${tabs[0]!.path}`} replace />;
}
