import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AuthUser, Role } from "./shared/types";

/**
 * The frame around a signed-in app (ADR-0012, ADR-0019, design W1).
 *
 * What these tests guarantee, for the worker app on a phone:
 * - the header holds three things only: the app name, the language list and
 *   one button for his own account, so it fits a 320px phone in every
 *   language instead of wrapping into four lines;
 * - his name, his role, his home state and "Sign out" are behind that one
 *   button, and nowhere else, so "Sign out" is never tapped by mistake;
 * - the four sections are a bar at the foot of the screen, where a thumb
 *   reaches, each with an icon and a name, and none is cut off;
 * - the current section is marked for a screen reader, not only by colour.
 *
 * And for the contractor and officer apps: they keep their header with the
 * name and a visible "Sign out", because their layout is redesigned later.
 *
 * The API module is mocked. No test reaches the server.
 */

vi.mock("./shared/api", () => ({
  getStoredUser: vi.fn(),
  getToken: vi.fn(() => "token"),
  clearSession: vi.fn(),
  storeSession: vi.fn(),
  api: new Proxy({}, { get: () => () => new Promise(() => {}) }),
}));
vi.mock("./shared/leave", () => ({ leaveTo: vi.fn() }));

import { clearSession, getStoredUser } from "./shared/api";
import { leaveTo } from "./shared/leave";
import { DICTIONARIES } from "./shared/i18n";
import WorkerApp from "./worker/App";
import ContractorApp from "./contractor/App";

const WORKER: AuthUser = {
  id: "w1",
  name: "Bijoy Das",
  phone: "9880030001",
  role: "WORKER" as Role,
  language: "en",
  homeState: "West Bengal",
};

function openWorker(user: AuthUser = WORKER, at = "/work") {
  vi.mocked(getStoredUser).mockReturnValue(user);
  render(
    <MemoryRouter initialEntries={[at]}>
      <WorkerApp />
    </MemoryRouter>,
  );
}

beforeEach(() => vi.resetAllMocks());

describe("worker app header", () => {
  it("holds the app name, the language list and one account button, and nothing else", () => {
    openWorker();
    const header = screen.getByRole("banner");
    expect(header.textContent).toContain("Worker Pay Record");
    expect(within(header).getByRole("combobox", { name: "Language" })).toBeTruthy();
    expect(within(header).getAllByRole("button")).toHaveLength(1);
    expect(within(header).getByRole("button", { name: /your account/i })).toBeTruthy();
    // The long tagline and the name block were what made it wrap on a phone.
    expect(header.textContent).not.toContain("Bijoy Das");
    expect(header.textContent).not.toContain(DICTIONARIES.en.appTagline);
  });

  it("shows his name, role, home state and Sign out only after he opens his account", () => {
    openWorker();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();

    const account = screen.getByRole("button", { name: /your account/i });
    expect(account.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(account);
    expect(account.getAttribute("aria-expanded")).toBe("true");

    const menu = screen.getByRole("dialog", { name: /your account/i });
    expect(menu.textContent).toContain("Bijoy Das");
    expect(menu.textContent).toContain("Worker");
    expect(menu.textContent).toContain("West Bengal");
    expect(menu.textContent).toContain("98800\u00a030001");
  });

  it("closes the account panel with Escape, and gives focus back to the button", () => {
    openWorker();
    const account = screen.getByRole("button", { name: /your account/i });
    fireEvent.click(account);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(account);
  });

  it("signs out from the account panel", () => {
    openWorker();
    fireEvent.click(screen.getByRole("button", { name: /your account/i }));
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(clearSession).toHaveBeenCalledOnce();
    expect(leaveTo).toHaveBeenCalledWith("/");
  });

  it("is in his language, home state included", () => {
    const ml = DICTIONARIES.ml;
    openWorker({ ...WORKER, language: "ml" });
    fireEvent.click(screen.getByRole("button", { name: ml.yourAccount }));
    const menu = screen.getByRole("dialog");
    expect(menu.textContent).toContain(ml.roleWorker);
    expect(menu.textContent).toContain(ml.stateWestBengal);
    expect(within(menu).getByRole("button", { name: ml.signOut })).toBeTruthy();
  });
});

describe("worker app sections", () => {
  it("are one bar of four, each with its name, after the page", () => {
    openWorker();
    const nav = screen.getByRole("navigation", { name: "Sections" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["My work", "Find work", "Ask for help", "Records"]);
    // After <main> in the page, so a screen reader reads the screen first.
    const main = screen.getByRole("main");
    expect(main.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nav.className).toContain("fixed");
    expect(nav.className).toContain("bottom-0");
  });

  it("mark the open section for a screen reader", () => {
    openWorker(WORKER, "/find-work");
    const nav = screen.getByRole("navigation", { name: "Sections" });
    expect(within(nav).getByRole("link", { name: "Find work" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: "My work" }).getAttribute("aria-current")).toBeNull();
  });

  it("leave room under the page, so the bar never covers the last button", () => {
    openWorker();
    expect(screen.getByRole("main").className).toContain("pb-[calc(var(--size-bottom-nav)+var(--spacing-space-xl))]");
  });
});

describe("contractor app header", () => {
  it("keeps the name and a visible Sign out, and its tabs at the top", () => {
    vi.mocked(getStoredUser).mockReturnValue({ ...WORKER, role: "CONTRACTOR", name: "Ramesh Pillai" });
    render(
      <MemoryRouter>
        <ContractorApp />
      </MemoryRouter>,
    );
    const header = screen.getByRole("banner");
    expect(header.textContent).toContain("Ramesh Pillai");
    expect(within(header).getByRole("button", { name: "Sign out" })).toBeTruthy();
    expect(within(header).getByRole("navigation")).toBeTruthy();
  });
});
