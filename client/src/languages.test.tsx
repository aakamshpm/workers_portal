import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AuthUser, Role } from "./shared/types";

/**
 * Language in the three apps. ADR-0015.
 *
 * What these tests guarantee:
 * - the worker app opens in the worker's own language (User.language);
 * - the worker can change it from the header, and the change is saved on the
 *   server, so later SMS use it too;
 * - the page tells the browser its language (<html lang>), so a screen reader
 *   reads it with the right voice;
 * - the contractor and officer apps stay English and have no language choice,
 *   even when the account's language is not English (an officer-made account
 *   has "ml", because that is the SMS language in Kerala).
 *
 * The API module is mocked. No test reaches the server.
 */

const { setLanguage } = vi.hoisted(() => ({ setLanguage: vi.fn() }));

vi.mock("./shared/api", () => ({
  getStoredUser: vi.fn(),
  getToken: vi.fn(() => "token"),
  clearSession: vi.fn(),
  storeSession: vi.fn(),
  api: new Proxy(
    {},
    // Every page request stays on its loading state, except the one under test.
    { get: (_t, name) => (name === "setLanguage" ? setLanguage : () => new Promise(() => {})) },
  ),
}));

vi.mock("./shared/leave", () => ({ leaveTo: vi.fn() }));

import { getStoredUser, storeSession } from "./shared/api";
import { DICTIONARIES } from "./shared/i18n";
import { en } from "./shared/i18n/en";
import WorkerApp from "./worker/App";
import ContractorApp from "./contractor/App";
import OfficerApp from "./officer/App";

const person = (role: Role, language: string): AuthUser => ({
  id: `u-${role}`,
  name: role,
  phone: "9845687924",
  role,
  language,
});

function open(App: () => React.ReactElement | null, user: AuthUser) {
  vi.mocked(getStoredUser).mockReturnValue(user);
  render(
    <MemoryRouter>
      <App />
    </MemoryRouter>,
  );
}

function tabs() {
  const nav = screen.getByRole("navigation", { name: /./ });
  return Array.from(nav.querySelectorAll("a")).map((a) => a.textContent);
}

beforeEach(() => {
  vi.resetAllMocks();
  document.documentElement.lang = "";
});

describe("worker app", () => {
  it("opens in the worker's own language", () => {
    const bn = DICTIONARIES.bn;
    open(WorkerApp, person("WORKER", "bn"));
    expect(tabs()).toEqual([bn.tabMyWork, bn.tabFindWork, bn.tabHelp, bn.tabRecords]);
    expect(document.documentElement.lang).toBe("bn");
  });

  it("uses English when the worker's language is unknown", () => {
    open(WorkerApp, person("WORKER", "ta"));
    expect(tabs()).toEqual([en.tabMyWork, en.tabFindWork, en.tabHelp, en.tabRecords]);
  });

  it("changes language from the header and saves it on the server", async () => {
    const hi = DICTIONARIES.hi;
    const updated = { ...person("WORKER", "hi") };
    setLanguage.mockResolvedValue({ token: "new-token", user: updated });
    open(WorkerApp, person("WORKER", "bn"));

    fireEvent.change(screen.getByRole("combobox", { name: DICTIONARIES.bn.language }), {
      target: { value: "hi" },
    });

    expect(tabs()).toEqual([hi.tabMyWork, hi.tabFindWork, hi.tabHelp, hi.tabRecords]);
    expect(document.documentElement.lang).toBe("hi");
    expect(setLanguage).toHaveBeenCalledWith("hi");
    await waitFor(() => expect(storeSession).toHaveBeenCalledWith("new-token", updated));
  });
});

describe.each([
  ["contractor", ContractorApp, "CONTRACTOR" as Role],
  ["officer", OfficerApp, "AUTHORITY" as Role],
])("%s app", (_name, App, role) => {
  it("stays English with no language choice, even for a Malayalam account", () => {
    open(App, person(role, "ml"));
    expect(screen.queryByRole("combobox", { name: /language/i })).toBeNull();
    expect(screen.getByRole("button", { name: en.signOut })).toBeTruthy();
    expect(document.documentElement.lang).not.toBe("ml");
  });
});
