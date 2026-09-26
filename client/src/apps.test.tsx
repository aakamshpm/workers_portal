import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AuthUser, Role } from "./shared/types";

/**
 * The three apps. ADR-0012.
 *
 * What these tests guarantee:
 * - each app opens only for its own role, and sends anyone else to the app
 *   that is theirs, so a worker can never land on the pay screen or the
 *   complaint desk by typing an address;
 * - a signed-out visitor to any app is sent to the sign-in page at "/";
 * - sign-in sends each role to its own app;
 * - each app shows only its own tabs.
 *
 * Leaving an app is a full page load (window.location), because each app is a
 * separate bundle. The tests replace `leaveTo` so no navigation really happens.
 *
 * The API module is mocked. No test reaches the server.
 */

vi.mock("./shared/api", () => ({
  getStoredUser: vi.fn(),
  getToken: vi.fn(() => "token"),
  clearSession: vi.fn(),
  storeSession: vi.fn(),
  api: new Proxy(
    {},
    // Every page's first request never answers, so each page stays on its own
    // loading state. These tests are about which app opens, not page content.
    { get: () => () => new Promise(() => {}) },
  ),
}));

vi.mock("./shared/leave", () => ({ leaveTo: vi.fn() }));

import { getStoredUser } from "./shared/api";
import { leaveTo } from "./shared/leave";
import { appFor } from "./shared/apps";
import WorkerApp from "./worker/App";
import ContractorApp from "./contractor/App";
import OfficerApp from "./officer/App";

const person = (role: Role): AuthUser => ({ id: `u-${role}`, name: role, phone: "9880030001", role });

function signedInAs(role: Role | null) {
  vi.mocked(getStoredUser).mockReturnValue(role ? person(role) : null);
}

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.mocked(leaveTo).mockReset());

const APPS = [
  { name: "worker", role: "WORKER" as Role, App: WorkerApp, base: "/worker/" },
  { name: "contractor", role: "CONTRACTOR" as Role, App: ContractorApp, base: "/contractor/" },
  { name: "officer", role: "AUTHORITY" as Role, App: OfficerApp, base: "/officer/" },
];

describe("appFor", () => {
  it("names each role's own app", () => {
    expect(appFor("WORKER")).toBe("/worker/");
    expect(appFor("CONTRACTOR")).toBe("/contractor/");
    expect(appFor("AUTHORITY")).toBe("/officer/");
  });
});

describe.each(APPS)("the $name app", ({ role, App, base }) => {
  it("sends a signed-out visitor to the sign-in page", () => {
    signedInAs(null);
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(leaveTo).toHaveBeenCalledWith("/");
  });

  it("opens for its own role, without leaving", () => {
    signedInAs(role);
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(leaveTo).not.toHaveBeenCalled();
    expect(screen.getByRole("navigation", { name: /sections/i })).toBeTruthy();
  });

  it.each(APPS.filter((other) => other.role !== role))(
    "sends a $role user to their own app, $base",
    (other) => {
      signedInAs(other.role);
      render(
        <MemoryRouter>
          <App />
        </MemoryRouter>,
      );
      expect(leaveTo).toHaveBeenCalledWith(other.base);
      expect(screen.queryByRole("navigation", { name: /sections/i })).toBeNull();
    },
  );

  it("uses its own address", () => {
    expect(base).toBe(appFor(role));
  });
});

describe("each app shows only its own tabs", () => {
  function tabsOf(App: () => ReactElement | null, role: Role) {
    signedInAs(role);
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    const nav = screen.getByRole("navigation", { name: /sections/i });
    return Array.from(nav.querySelectorAll("a")).map((a) => a.textContent);
  }

  it("worker: his work, finding work, help, records. No pay, no complaint desk", () => {
    expect(tabsOf(WorkerApp, "WORKER")).toEqual(["My work", "Find work", "Ask for help", "All records"]);
  });

  it("contractor: his workers, paying, records. No find work, no complaint desk", () => {
    expect(tabsOf(ContractorApp, "CONTRACTOR")).toEqual(["My workers", "Pay a worker", "All records"]);
  });

  it("officer: complaints and records. No hiring and no pay screens", () => {
    expect(tabsOf(OfficerApp, "AUTHORITY")).toEqual(["Complaints", "All records"]);
  });
});
